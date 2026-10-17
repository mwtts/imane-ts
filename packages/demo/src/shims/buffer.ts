// サーバのコードが使う範囲(文字列・base64 からのバイト列化)だけの Buffer の代替

const DemoBuffer = {
  from(value: string | Uint8Array, encoding?: string): Uint8Array {
    if (typeof value !== "string") return value;
    if (encoding === "base64") return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextEncoder().encode(value);
  },
};

const scope = globalThis as { Buffer?: unknown };
scope.Buffer ??= DemoBuffer;
