import "./shims/buffer";
import { join } from "node:path";
import { createApp } from "@imane/server/src/app";
import { SessionStore } from "@imane/server/src/auth";
import { WorkflowManager } from "@imane/server/src/engine/manager";
import { systemClock } from "@imane/server/src/engine/workflow";
import { Notifier, type PushSocket } from "@imane/server/src/notifier";
import { loadProduct } from "@imane/server/src/scenario/loader";
import { ScenarioStore } from "@imane/server/src/scenario/store";

export interface DemoServer {
  fetch(req: Request): Promise<Response>;
  /** プッシュ通知の受け口をつなぐ。セションが無効なら undefined、有効なら切断する関数を返す */
  connect(token: string, socket: PushSocket): (() => void) | undefined;
  stop(): void;
}

/** packages/server/src/index.ts と同じ構成のサーバを、HTTP を待ち受けずに組み立てる */
export function createDemoServer(dataDir: string, checkInterval = 1000): DemoServer {
  const scenarios = new ScenarioStore(join(dataDir, "scenarios"), join(dataDir, "sys"));
  let manager: WorkflowManager | undefined;
  const notifier = new Notifier(scenarios, (team, email) => manager?.find(team)?.ownedStates(email) ?? []);
  manager = new WorkflowManager({ scenarios, clock: systemClock, publish: (msg) => notifier.publish(msg) });
  manager.startTicker(checkInterval);

  const sessions = new SessionStore(systemClock);
  const app = createApp({
    scenarios,
    manager,
    notifier,
    sessions,
    product: loadProduct(join(dataDir, "sys")),
    // サンプルシナリオのファシリテータはパスワードを持たない
    allowPasswordlessAdmin: true,
  });

  return {
    fetch: async (req) => app.fetch(req),
    connect(token, socket) {
      const email = sessions.get(token);
      if (!email) return undefined;
      notifier.connect(email, socket);
      return () => notifier.disconnect(email, socket);
    },
    stop: () => manager.stopTicker(),
  };
}
