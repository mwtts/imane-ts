// node:fs の代替。同梱のサンプルシナリオを /data に置いたメモリ上のファイルシステムで動かす

import { type DirEntry, MemoryFs } from "../memory-fs";

export const DATA_DIR = "/data";

const vfs = new MemoryFs();

const seed = import.meta.glob(["../../../server/data/scenarios/*.json", "../../../server/data/sys/*.json"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

for (const [path, text] of Object.entries(seed)) {
  const target = `${DATA_DIR}/${path.slice(path.indexOf("/data/") + "/data/".length)}`;
  vfs.mkdir(target.slice(0, target.lastIndexOf("/")));
  vfs.writeFile(target, text);
}

export const existsSync = (path: string) => vfs.exists(path);
export const statSync = (path: string) => vfs.stat(path);
export const readFileSync = (path: string) => vfs.readFile(path);
export const writeFileSync = (path: string, data: Uint8Array | string) => vfs.writeFile(path, data);
export const mkdirSync = (path: string) => vfs.mkdir(path);
export const renameSync = (from: string, to: string) => vfs.rename(from, to);
export const rmSync = (path: string, options?: { recursive?: boolean; force?: boolean }) => vfs.rm(path, options);

export function readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
export function readdirSync(path: string): string[];
export function readdirSync(path: string, options?: { withFileTypes?: boolean }): DirEntry[] | string[] {
  const entries = vfs.readdir(path);
  return options?.withFileTypes ? entries : entries.map((e) => e.name);
}
