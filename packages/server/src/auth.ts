import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Clock } from "./engine/workflow";

const HASH_ALGORITHMS: Record<string, string> = {
  MD5: "md5",
  SHA: "sha1",
  SHA1: "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
};

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * contacts.json の passwd と照合する。
 * passwd 未設定なら常に成功。"{SHA}base64" 形式(ldappasswd 互換)はハッシュで、それ以外は平文として比較する。
 */
export function verifyPassword(stored: string | undefined, plain: string | undefined): boolean {
  if (stored === undefined || stored === "") return true;
  const input = plain ?? "";
  const m = /^\{([A-Za-z0-9]+)\}(.*)$/s.exec(stored);
  if (!m) return safeEqual(Buffer.from(stored), Buffer.from(input));
  const algorithm = HASH_ALGORITHMS[m[1]!.toUpperCase()];
  if (!algorithm) return false;
  const expected = Buffer.from(m[2]!, "base64");
  return safeEqual(createHash(algorithm).update(input, "utf8").digest(), expected);
}

/** "{SHA256}base64" 形式のハッシュを作る(シナリオ作成者向け) */
export function hashPassword(plain: string, algorithm: keyof typeof HASH_ALGORITHMS = "SHA256"): string {
  const digest = createHash(HASH_ALGORITHMS[algorithm]!).update(plain, "utf8").digest("base64");
  return `{${algorithm}}${digest}`;
}

interface SessionEntry {
  userid: string;
  lastSeen: number;
}

/** ログインセション。最後のアクセスから idleMs を過ぎたものは無効 */
export class SessionStore {
  private sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly clock: Clock,
    private readonly idleMs = 12 * 60 * 60 * 1000,
  ) {}

  create(userid: string): string {
    const now = this.clock.now();
    for (const [k, e] of this.sessions) if (now - e.lastSeen > this.idleMs) this.sessions.delete(k);
    const key = randomBytes(32).toString("hex");
    this.sessions.set(key, { userid, lastSeen: this.clock.now() });
    return key;
  }

  /** 有効なセションのユーザIDを返し、最終アクセス日時を更新する */
  get(key: string | undefined): string | undefined {
    if (!key) return undefined;
    const entry = this.sessions.get(key);
    if (!entry) return undefined;
    const now = this.clock.now();
    if (now - entry.lastSeen > this.idleMs) {
      this.sessions.delete(key);
      return undefined;
    }
    entry.lastSeen = now;
    return entry.userid;
  }

  delete(key: string | undefined): void {
    if (key) this.sessions.delete(key);
  }
}
