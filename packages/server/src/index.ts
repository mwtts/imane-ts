import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { websocket } from "@hono/bun";
import { createApp } from "./app";
import { SessionStore } from "./auth";
import { WorkflowManager } from "./engine/manager";
import { systemClock } from "./engine/workflow";
import { createLogger } from "./logger";
import { Notifier } from "./notifier";
import { loadProduct } from "./scenario/loader";
import { ScenarioStore } from "./scenario/store";

const log = createLogger("main");

const dataDir = resolve(process.env.DATA_DIR ?? join(import.meta.dir, "..", "data"));
const staticDir = resolve(process.env.STATIC_DIR ?? join(import.meta.dir, "..", "..", "client", "dist"));
const port = Number(process.env.PORT ?? 8080);

const scenarios = new ScenarioStore(join(dataDir, "scenarios"), join(dataDir, "sys"));
let manager: WorkflowManager | undefined;
const notifier = new Notifier(scenarios, (team, email) => manager?.find(team)?.ownedStates(email) ?? []);
manager = new WorkflowManager({ scenarios, clock: systemClock, publish: (msg) => notifier.publish(msg) });
manager.startTicker(Number(process.env.CHECK_INTERVAL ?? 1000));

const app = createApp({
  scenarios,
  manager,
  notifier,
  sessions: new SessionStore(systemClock),
  product: loadProduct(join(dataDir, "sys")),
  staticDir: existsSync(staticDir) ? staticDir : undefined,
  allowPasswordlessAdmin: process.env.ALLOW_PASSWORDLESS_ADMIN === "true",
});

Bun.serve({ port, fetch: app.fetch, websocket });

log.info(`IMANE サーバを起動しました: http://localhost:${port}/ (data: ${dataDir})`);
if (!existsSync(staticDir)) log.warn(`クライアントが未ビルドです。bun run build を実行してください。(${staticDir})`);
