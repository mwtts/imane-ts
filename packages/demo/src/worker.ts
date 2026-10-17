// すべてのタブで共有するサーバ。ファシリテータと参加者を別々のタブで開いて演習できる

import type { FromWorker, ToWorker } from "./protocol";
import { createDemoServer } from "./server";
import { DATA_DIR } from "./shims/fs";

const server = createDemoServer(DATA_DIR);

async function respond(port: MessagePort, msg: Extract<ToWorker, { type: "fetch" }>): Promise<void> {
  let res: Response;
  try {
    res = await server.fetch(new Request(msg.url, { method: msg.method, headers: msg.headers, body: msg.body }));
  } catch (e) {
    console.error("デモサーバの処理に失敗しました。", e);
    res = Response.json({ status: 500, message: "サーバ内部でエラーが発生しました。" }, { status: 500 });
  }
  const body = await res.arrayBuffer();
  const reply: FromWorker = {
    type: "response",
    id: msg.id,
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers],
    body,
  };
  port.postMessage(reply, [body]);
}

function accept(port: MessagePort): void {
  const sockets = new Map<number, () => void>();
  const send = (msg: FromWorker) => port.postMessage(msg);

  port.onmessage = (ev: MessageEvent<ToWorker>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "fetch":
        void respond(port, msg);
        break;
      case "connect": {
        const disconnect = server.connect(msg.token, { send: (data) => send({ type: "push", id: msg.id, data }) });
        if (disconnect) sockets.set(msg.id, disconnect);
        else send({ type: "closed", id: msg.id });
        break;
      }
      case "disconnect":
        sockets.get(msg.id)?.();
        sockets.delete(msg.id);
        break;
      case "release":
        for (const disconnect of sockets.values()) disconnect();
        sockets.clear();
        break;
    }
  };
}

const scope = self as unknown as { onconnect: ((ev: MessageEvent) => void) | null };
scope.onconnect = (ev) => {
  const port = ev.ports[0];
  if (port) accept(port);
};
