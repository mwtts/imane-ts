import { join } from "./shims/path";

export interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface Stat {
  mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

function noEntry(op: string, path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${path}'`), { code: "ENOENT" });
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/** サーバのシナリオ管理(ScenarioStore)が使う範囲だけを実装した、メモリ上のファイルシステム */
export class MemoryFs {
  private files = new Map<string, { data: Uint8Array; mtimeMs: number }>();
  private dirs = new Set<string>(["/"]);
  /** 更新の検出に使う。時計ではなく書き込みごとに増やす */
  private revision = 0;

  private addDirs(path: string): void {
    for (let p = path; !this.dirs.has(p); p = parentOf(p)) this.dirs.add(p);
  }

  exists(path: string): boolean {
    const p = join(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  stat(path: string): Stat {
    const p = join(path);
    const file = this.files.get(p);
    if (file) return { mtimeMs: file.mtimeMs, isDirectory: () => false, isFile: () => true };
    if (this.dirs.has(p)) return { mtimeMs: 0, isDirectory: () => true, isFile: () => false };
    throw noEntry("stat", p);
  }

  readFile(path: string): Uint8Array {
    const p = join(path);
    const file = this.files.get(p);
    if (!file) throw noEntry("open", p);
    return file.data.slice();
  }

  writeFile(path: string, data: Uint8Array | string): void {
    const p = join(path);
    if (!this.dirs.has(parentOf(p))) throw noEntry("open", p);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
    this.files.set(p, { data: bytes, mtimeMs: ++this.revision });
  }

  mkdir(path: string): void {
    this.addDirs(join(path));
  }

  readdir(path: string): DirEntry[] {
    const p = join(path);
    if (!this.dirs.has(p)) throw noEntry("scandir", p);
    const prefix = p === "/" ? "/" : `${p}/`;
    const children = (keys: Iterable<string>) =>
      [...keys].filter((k) => k !== p && parentOf(k) === p).map((k) => k.slice(prefix.length));
    return [
      ...children(this.dirs).map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
      ...children(this.files.keys()).map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
    ];
  }

  rename(from: string, to: string): void {
    const src = join(from);
    const dst = join(to);
    if (!this.exists(src)) throw noEntry("rename", src);
    const moved = (key: string) => `${dst}${key.slice(src.length)}`;
    const under = (key: string) => key === src || key.startsWith(`${src}/`);
    for (const [key, file] of [...this.files]) {
      if (!under(key)) continue;
      this.files.delete(key);
      this.files.set(moved(key), { ...file, mtimeMs: ++this.revision });
    }
    for (const key of [...this.dirs]) {
      if (!under(key)) continue;
      this.dirs.delete(key);
      this.dirs.add(moved(key));
    }
    this.addDirs(parentOf(dst));
  }

  rm(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    const p = join(path);
    if (!this.exists(p)) {
      if (options.force) return;
      throw noEntry("rm", p);
    }
    if (this.dirs.has(p) && !options.recursive) throw new Error(`EISDIR: is a directory, rm '${p}'`);
    for (const key of [...this.files.keys()]) if (key === p || key.startsWith(`${p}/`)) this.files.delete(key);
    for (const key of [...this.dirs]) if (key === p || key.startsWith(`${p}/`)) this.dirs.delete(key);
  }
}
