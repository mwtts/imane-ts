// node:crypto の代替。デモ版はパスワードを設定しないサンプルシナリオで使う想定で、ハッシュの照合には対応しない

export function createHash(): never {
  throw new Error("デモ版ではハッシュ形式のパスワードに対応していません。");
}

export function randomBytes(size: number): { toString(encoding: "hex"): string } {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return { toString: () => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
