import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AvailableCard, NotificationMessage, SessionData } from "@imane/shared";
import { createApp } from "../src/app";
import { hashPassword, SessionStore, verifyPassword } from "../src/auth";
import { WorkflowManager } from "../src/engine/manager";
import { Notifier } from "../src/notifier";
import { ScenarioStore } from "../src/scenario/store";
import { FakeClock } from "./fixtures";

const TEAM = "SampleCompany.com";
const work = mkdtempSync(join(tmpdir(), "imane-api-"));
cpSync(join(import.meta.dir, "..", "data"), work, { recursive: true });
afterAll(() => rmSync(work, { recursive: true, force: true }));

const clock = new FakeClock();
const scenarios = new ScenarioStore(join(work, "scenarios"), join(work, "sys"));
let manager: WorkflowManager;
const notifier = new Notifier(scenarios, (team, email) => manager.find(team)?.ownedStates(email) ?? []);
manager = new WorkflowManager({ scenarios, clock, publish: (m) => notifier.publish(m) });
const ctx = { scenarios, manager, notifier, sessions: new SessionStore(clock), product: { CAPTION: "test" } };
const app = createApp({ ...ctx, allowPasswordlessAdmin: true });

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : undefined };
}

async function login(userid: string): Promise<string> {
  const r = await call("POST", "/api/session", undefined, { userid });
  expect(r.status).toBe(200);
  return (r.json as SessionData).sessionkey;
}

let admin: string;
let leader: string;

beforeAll(async () => {
  admin = await login(`facilitator@${TEAM}`);
  leader = await login(`IT課長@${TEAM}`);
});

describe("認証", () => {
  test("ログイン候補には自動応答ユーザを含めず、パスワード項目を返さない", async () => {
    const r = await call("GET", "/api/login-options");
    const roles = r.json.members.map((m: { role: string }) => m.role);
    expect(roles).toContain("IT課長");
    expect(roles).not.toContain("CSIRT");
    expect(r.text).not.toContain("passwd");
  });

  test("パスワード未設定のファシリテータは、試用モードでなければログインできない", async () => {
    const strict = createApp(ctx);
    const res = await strict.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userid: `facilitator@${TEAM}` }),
    });
    expect(res.status).toBe(401);
    const participant = await strict.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userid: `IT課長@${TEAM}` }),
    });
    expect(participant.status).toBe(200);
  });

  test("存在しないユーザはログインできない", async () => {
    expect((await call("POST", "/api/session", undefined, { userid: "nobody@x" })).status).toBe(401);
  });

  test("未ログインでは API を呼べない", async () => {
    expect((await call("GET", "/api/processes")).status).toBe(401);
    expect((await call("GET", "/api/actions", "bogus")).status).toBe(401);
  });

  test("セションはユーザごとに独立している", async () => {
    expect((await call("GET", "/api/session", leader)).json.role).toBe("IT課長");
    expect((await call("GET", "/api/session", admin)).json.role).toBe("facilitator");
  });

  test("パスワード照合: 平文・{SHA}・{MD5}・{SHA256}", () => {
    const sha1 = `{SHA}${createHash("sha1").update("secret").digest("base64")}`;
    const md5 = `{MD5}${createHash("md5").update("secret").digest("base64")}`;
    expect(verifyPassword(undefined, "anything")).toBe(true);
    expect(verifyPassword("secret", "secret")).toBe(true);
    expect(verifyPassword("secret", "wrong")).toBe(false);
    expect(verifyPassword(sha1, "secret")).toBe(true);
    expect(verifyPassword(md5, "secret")).toBe(true);
    expect(verifyPassword(md5, "secret2")).toBe(false);
    expect(verifyPassword(hashPassword("pw"), "pw")).toBe(true);
    expect(verifyPassword("{ROT13}abc", "abc")).toBe(false);
  });
});

describe("権限", () => {
  test("参加者はフェーズを開始できない", async () => {
    expect((await call("POST", `/api/teams/${TEAM}/start`, leader, { phase: 1 })).status).toBe(403);
  });

  test("参加者は他チームやキューを参照できない", async () => {
    expect((await call("GET", "/api/teams/other.example/workflow", leader)).status).toBe(403);
    expect((await call("GET", `/api/teams/${TEAM}/queue`, leader)).status).toBe(403);
  });
});

describe("演習の進行", () => {
  test("フェーズ開始前のアクションは拒否される", async () => {
    const r = await call("POST", "/api/actions", leader, { actionId: "i0001", to: "OT課長", message: "hi" });
    expect(r.status).toBe(400);
  });

  test("ファシリテータがフェーズを開始できる", async () => {
    const r = await call("POST", `/api/teams/${TEAM}/start`, admin, { phase: 1 });
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("Started");
    expect((await call("POST", `/api/teams/${TEAM}/start`, admin, { phase: 9 })).status).toBe(400);
  });

  test("条件を満たさないアクションはサーバ側で拒否される", async () => {
    const cards = (await call("GET", "/api/actions", leader)).json as AvailableCard[];
    expect(cards.find((c) => c.id === "A00007")?.available).toBe(false);
    const r = await call("POST", "/api/actions", leader, { actionId: "A00007", to: "CSIRT" });
    expect(r.status).toBe(400);
  });

  test("所有していないステートは添付できない", async () => {
    const r = await call("POST", "/api/actions", leader, { actionId: "i0009", to: "OT課長", attachments: ["20020005"] });
    expect(r.status).toBe(400);
    expect(r.json.message).toContain("添付できない");
  });

  test("自動アクション用のカードは参加者が送れない", async () => {
    const r = await call("POST", "/api/actions", leader, { actionId: "A00004", to: "CSIRT" });
    expect(r.status).toBe(403);
  });

  test("連絡を送ると送信者と宛先の履歴に残る", async () => {
    const r = await call("POST", "/api/actions", leader, { actionId: "i0001", to: "OT課長", message: "状況を共有します" });
    expect(r.status).toBe(202);
    const mine = (await call("GET", `/api/teams/${TEAM}/history`, leader)).json as NotificationMessage[];
    const sent = mine.find((m) => m.id === r.json.id);
    expect(sent?.message).toBe("状況を共有します");
    expect(sent?.from.role).toBe("IT課長");
    expect(JSON.stringify(mine)).not.toContain("passwd");
  });

  test("状態を保存して復元できる", async () => {
    const saved = await call("GET", "/api/snapshots", admin);
    expect(saved.status).toBe(200);
    expect(saved.json[0].team).toBe(TEAM);
    const restored = await call("POST", "/api/snapshots", admin, saved.json);
    expect(restored.status).toBe(200);
    expect(restored.json[0].workflow.state).toBe("Suspended");
    expect((await call("POST", `/api/teams/${TEAM}/resume`, admin)).json.state).toBe("Started");
  });

  test("ファシリテータは中断できる", async () => {
    const r = await call("POST", `/api/teams/${TEAM}/abort`, admin);
    expect(r.json.state).toBe("Aborted");
  });
});
