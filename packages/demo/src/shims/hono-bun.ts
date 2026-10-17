// @hono/bun の代替。デモ版は静的ファイルを配信せず、プッシュ通知は WebSocket を介さずに直接つなぐ(../server.ts)

import type { MiddlewareHandler } from "hono";

export const serveStatic = (): MiddlewareHandler => async (_c, next) => {
  await next();
};

export const upgradeWebSocket = (): MiddlewareHandler => async (c) =>
  c.json({ status: 501, message: "デモ版では WebSocket に対応していません。" }, 501);
