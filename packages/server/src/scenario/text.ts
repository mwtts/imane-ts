import { readFileSync } from "node:fs";
import iconv from "iconv-lite";
import JSON5 from "json5";

export class ScenarioFileError extends Error {
  constructor(
    message: string,
    readonly file: string,
    options?: { cause?: unknown },
  ) {
    super(`${message} [${file}]`, options);
    this.name = "ScenarioFileError";
  }
}

const startsWith = (buf: Uint8Array, sig: number[]) => sig.every((b, i) => buf[i] === b);

/**
 * テキストファイルを文字コードを推定して読み込む。
 * BOM(UTF-8/16/32)を優先し、BOMがなければ UTF-8 として厳密にデコードを試み、失敗したら Shift_JIS とみなす。
 */
export function decodeText(buf: Uint8Array): string {
  if (startsWith(buf, [0xef, 0xbb, 0xbf])) return new TextDecoder("utf-8").decode(buf.subarray(3));
  if (startsWith(buf, [0x00, 0x00, 0xfe, 0xff])) return iconv.decode(Buffer.from(buf.subarray(4)), "utf-32be");
  if (startsWith(buf, [0xff, 0xfe, 0x00, 0x00])) return iconv.decode(Buffer.from(buf.subarray(4)), "utf-32le");
  if (startsWith(buf, [0xfe, 0xff])) return iconv.decode(Buffer.from(buf.subarray(2)), "utf-16be");
  if (startsWith(buf, [0xff, 0xfe])) return iconv.decode(Buffer.from(buf.subarray(2)), "utf-16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return iconv.decode(Buffer.from(buf), "Shift_JIS");
  }
}

/**
 * 寛容な JSON パース。末尾カンマ・コメント・単一引用符を許容する(旧実装の org.json 相当)。
 */
export function parseLenientJson(text: string, file: string): unknown {
  try {
    return JSON5.parse(text);
  } catch (e) {
    throw new ScenarioFileError(`JSONの解析に失敗しました: ${(e as Error).message}`, file, { cause: e });
  }
}

export function readJsonFile(path: string): unknown {
  let buf: Uint8Array;
  try {
    buf = readFileSync(path);
  } catch (e) {
    throw new ScenarioFileError("シナリオデータの読み込みに失敗しました。", path, { cause: e });
  }
  return parseLenientJson(decodeText(buf), path);
}
