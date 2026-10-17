import { describe, expect, test } from "bun:test";
import { MemoryFs } from "../src/memory-fs";
import { basename, join, relative, resolve } from "../src/shims/path";

const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("path", () => {
  test("join は区切りと . / .. を正規化する", () => {
    expect(join("/data", "scenarios", "a.json")).toBe("/data/scenarios/a.json");
    expect(join("/data/", "./x/../sys")).toBe("/data/sys");
    expect(join("a", "")).toBe("a");
  });

  test("resolve は絶対パスを返す", () => {
    expect(resolve("/data", "sys")).toBe("/data/sys");
    expect(resolve("/data", "/other")).toBe("/other");
  });

  test("basename と relative", () => {
    expect(basename("/data/scenarios/setting.json")).toBe("setting.json");
    expect(basename("dir/x.zip/")).toBe("x.zip");
    expect(relative("/a/b", "/a/c/d")).toBe("../c/d");
  });
});

describe("MemoryFs", () => {
  test("書き込んだ内容を読み出し、更新ごとに mtime が変わる", () => {
    const fs = new MemoryFs();
    fs.mkdir("/data/scenarios");
    fs.writeFile("/data/scenarios/setting.json", '{"teams":[]}');
    const first = fs.stat("/data/scenarios/setting.json").mtimeMs;
    expect(text(fs.readFile("/data/scenarios/setting.json"))).toBe('{"teams":[]}');

    fs.writeFile("/data/scenarios/setting.json", new TextEncoder().encode("{}"));
    expect(fs.stat("/data/scenarios/setting.json").mtimeMs).toBeGreaterThan(first);
    expect(fs.stat("/data").isDirectory()).toBe(true);
  });

  test("存在しないファイルは ENOENT", () => {
    const fs = new MemoryFs();
    expect(() => fs.readFile("/none")).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(() => fs.stat("/none")).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(() => fs.writeFile("/no-dir/a.json", "")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  test("readdir は直下のファイルとディレクトリだけを返す", () => {
    const fs = new MemoryFs();
    fs.mkdir("/base/sub/deep");
    fs.writeFile("/base/a.json", "1");
    fs.writeFile("/base/sub/b.json", "2");
    const entries = fs.readdir("/base").map((e) => [e.name, e.isDirectory()]);
    expect(entries).toEqual([
      ["sub", true],
      ["a.json", false],
    ]);
  });

  test("rename はディレクトリを中身ごと移す", () => {
    const fs = new MemoryFs();
    fs.mkdir("/base/.upload-1");
    fs.writeFile("/base/.upload-1/setting.json", "{}");
    fs.rename("/base/.upload-1", "/base/extra");
    expect(fs.exists("/base/.upload-1")).toBe(false);
    expect(text(fs.readFile("/base/extra/setting.json"))).toBe("{}");
  });

  test("rm は recursive がなければディレクトリを消さず、force なら存在しなくてもよい", () => {
    const fs = new MemoryFs();
    fs.mkdir("/base/dir");
    fs.writeFile("/base/dir/a.json", "1");
    expect(() => fs.rm("/base/dir")).toThrow();
    fs.rm("/base/dir", { recursive: true });
    expect(fs.exists("/base/dir/a.json")).toBe(false);
    expect(fs.exists("/base")).toBe(true);
    expect(() => fs.rm("/base/dir", { force: true })).not.toThrow();
    expect(() => fs.rm("/base/dir")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  test("読み出した内容を書き換えても保存内容は変わらない", () => {
    const fs = new MemoryFs();
    fs.writeFile("/a", "abc");
    fs.readFile("/a")[0] = 0;
    expect(text(fs.readFile("/a"))).toBe("abc");
  });
});
