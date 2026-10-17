import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import iconv from "iconv-lite";
import type { NotificationMessage } from "@imane/shared";
import { WorkflowManager } from "../src/engine/manager";
import { ScenarioStore } from "../src/scenario/store";
import { decodeText, parseLenientJson } from "../src/scenario/text";
import { FakeClock } from "./fixtures";

const DATA = join(import.meta.dir, "..", "data");
const work = mkdtempSync(join(tmpdir(), "imane-test-"));
cpSync(DATA, work, { recursive: true });
afterAll(() => rmSync(work, { recursive: true, force: true }));

const store = () => new ScenarioStore(join(work, "scenarios"), join(work, "sys"));

describe("テキストとJSON", () => {
  test("BOM・Shift_JIS を判別して読む", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeText(iconv.encode("演習", "Shift_JIS"))).toBe("演習");
    expect(decodeText(new TextEncoder().encode("演習"))).toBe("演習");
  });

  test("末尾カンマを許容する", () => {
    expect(parseLenientJson('{"a":[1,2,],}', "x.json")).toEqual({ a: [1, 2] });
  });
});

describe("同梱のサンプルシナリオ", () => {
  test("既定データ(sys)とマージして読み込める", () => {
    const s = store().current();
    expect(s.setting.teams).toEqual([{ id: "SampleCompany.com", name: "SampleCompany" }]);
    expect(s.actions.find((a) => a.id === "i0009")?.attach).toBe(true); // sys/actions.json (BOM + 末尾カンマ)
    expect(s.actions.filter((a) => a.type === "auto").length).toBeGreaterThan(0);
    expect(s.members.get("CSIRT@SampleCompany.com")?.system).toEqual([true]);
    expect(s.replies.get(1)?.[0]?.name).toBe("空の応答"); // sys のリプライが先頭
  });

  test("検証結果がすべて正常", () => {
    expect(store().validate("_default_").every((v) => v.valid)).toBe(true);
  });

  test("フェーズ1を開始すると、トリガーと自動アクションの連鎖で演習が進む", () => {
    const clock = new FakeClock();
    const published: NotificationMessage[] = [];
    const scenarios = store();
    const manager = new WorkflowManager({ scenarios, clock, publish: (m) => published.push(m) });
    const inst = manager.start("SampleCompany.com", 1);

    for (let i = 0; i < 15; i++) {
      clock.advance(1);
      manager.tickAll();
    }
    const names = published.map((m) => m.reply?.name ?? m.action.name);
    expect(names).toContain("通知"); // 演習開始トリガー
    expect(published.some((m) => m.message === "演習を開始します。")).toBe(true);
    expect(published.some((m) => m.action.id === "A00004")).toBe(true); // サイバー攻撃１ (10010001 で起動)
    const states = new Set(inst.systemStates().filter((s) => s.when !== undefined).map((s) => s.id));
    expect(states.has("10010001")).toBe(true);
    expect(states.has("10020004")).toBe(true);
  });
});

describe("シナリオセットの登録", () => {
  const files = (s: ScenarioStore) => {
    const out: Record<string, Uint8Array> = {};
    const dir = s.dirOf("_default_");
    for (const f of ["setting.json", "contacts.json", "actions.json", "replies.json", "states.json", "points.json"]) {
      out[`set/${f}`] = readFileSync(join(dir, f));
    }
    return out;
  };

  test("正しいzipは登録され、一覧と有効化ができる", () => {
    const s = store();
    const result = s.importZip("second.zip", zipSync(files(s)));
    expect(result.installed).toBe(true);
    expect(s.list().map((i) => i.name)).toContain("second");
    s.activate("second");
    expect(s.activeName).toBe("second");
    expect(s.current().name).toBe("second");
  });

  test("壊れたデータは配置しない", () => {
    const s = store();
    const bad = files(s);
    bad["set/actions.json"] = new TextEncoder().encode("{ broken");
    const result = s.importZip("broken", zipSync(bad));
    expect(result.installed).toBe(false);
    expect(s.list().map((i) => i.name)).not.toContain("broken");
  });

  test("読み込めない内容のファイルは保存せず、現在のシナリオは使い続けられる", () => {
    const s = store();
    const before = readFileSync(join(s.dirOf("_default_"), "actions.json"));
    expect(() => s.putFile("_default_", "actions.json", new TextEncoder().encode('{"actions":[{"name":"x"}]}'))).toThrow(
      "保存しませんでした",
    );
    expect(readFileSync(join(s.dirOf("_default_"), "actions.json"))).toEqual(before);
    expect(() => s.current()).not.toThrow();
  });

  test("パスを含むシナリオ名やファイル名は拒否する", () => {
    const s = store();
    expect(() => s.dirOf("../etc")).toThrow("不正");
    expect(() => s.putFile("_default_", "../x.json", new Uint8Array())).toThrow("アップロードできない");
  });
});
