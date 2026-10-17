import type { FromWorker, ToWorker } from "./protocol";

/** クライアントの /api 呼び出しとプッシュ通知を、ブラウザ内のサーバにつなぐ */
export interface DemoTransport {
  fetch(req: Request): Promise<Response>;
  /** プッシュ通知を受け取る。セションが無効なら onClose を呼ぶ。戻り値で切断する */
  connect(token: string, onMessage: (data: string) => void, onClose: () => void): () => void;
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** SharedWorker のサーバにつなぐ(タブ間で状態を共有する) */
function workerTransport(): DemoTransport {
  const worker = new SharedWorker(new URL("./worker.ts", import.meta.url), { type: "module", name: "imane-demo" });
  const port = worker.port;
  const send = (msg: ToWorker, transfer: Transferable[] = []) => port.postMessage(msg, transfer);
  const pending = new Map<number, (res: Response) => void>();
  const sockets = new Map<number, { onMessage: (data: string) => void; onClose: () => void }>();
  let seq = 0;

  port.onmessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "response": {
        const body = NULL_BODY_STATUS.has(msg.status) ? null : msg.body;
        pending.get(msg.id)?.(new Response(body, msg));
        pending.delete(msg.id);
        break;
      }
      case "push":
        sockets.get(msg.id)?.onMessage(msg.data);
        break;
      case "closed":
        sockets.get(msg.id)?.onClose();
        sockets.delete(msg.id);
        break;
    }
  };
  window.addEventListener("pagehide", () => send({ type: "release" }));
  // 戻る・進むでキャッシュから復元されたページは接続を失っているので読み込み直す
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted) location.reload();
  });

  return {
    async fetch(req) {
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      const id = ++seq;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        send(
          { type: "fetch", id, method: req.method, url: req.url, headers: [...req.headers], body },
          body ? [body] : [],
        );
      });
    },
    connect(token, onMessage, onClose) {
      const id = ++seq;
      sockets.set(id, { onMessage, onClose });
      send({ type: "connect", id, token });
      return () => {
        if (sockets.delete(id)) send({ type: "disconnect", id });
      };
    },
  };
}

/** SharedWorker が使えないブラウザ(Android 版 Chrome など)では、ページ内でサーバを動かす */
async function inPageTransport(): Promise<DemoTransport> {
  const [{ createDemoServer }, { DATA_DIR }] = await Promise.all([import("./server"), import("./shims/fs")]);
  const server = createDemoServer(DATA_DIR);
  return {
    fetch: (req) => server.fetch(req),
    connect(token, onMessage, onClose) {
      const disconnect = server.connect(token, { send: (data) => queueMicrotask(() => onMessage(data)) });
      if (!disconnect) queueMicrotask(onClose);
      return disconnect ?? (() => {});
    },
  };
}

export async function createTransport(): Promise<DemoTransport> {
  if (typeof SharedWorker === "function") {
    try {
      return workerTransport();
    } catch (e) {
      console.warn("SharedWorker を起動できないため、ページ内でサーバを動かします。", e);
    }
  }
  return inPageTransport();
}

const isApi = (url: string | URL) => new URL(url, location.href).pathname.startsWith("/api/");

/** クライアントが使う WebSocket の代わり(/api/notification だけを扱う) */
class DemoWebSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private disconnect?: () => void;

  constructor(
    private readonly transport: DemoTransport,
    readonly url: string,
  ) {
    // 呼び出し側がハンドラを設定してからつなぐ
    queueMicrotask(() => this.open());
  }

  private open(): void {
    if (this.readyState !== WebSocket.CONNECTING) return;
    this.readyState = WebSocket.OPEN;
    const token = new URL(this.url, location.href).searchParams.get("token") ?? "";
    this.disconnect = this.transport.connect(
      token,
      (data) => this.onmessage?.(new MessageEvent("message", { data })),
      () => this.finish(),
    );
    this.onopen?.(new Event("open"));
  }

  send(): void {
    // クライアントからは送信しない
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.disconnect?.();
    this.finish();
  }

  private finish(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

/** fetch と WebSocket を差し替え、/api への要求だけをブラウザ内のサーバに回す */
export function install(transport: DemoTransport): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input;
    return isApi(url) ? transport.fetch(new Request(input, init)) : nativeFetch(input, init);
  }) as typeof fetch;
  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      return isApi(args[0]) ? new DemoWebSocket(transport, String(args[0])) : Reflect.construct(target, args);
    },
  });
}
