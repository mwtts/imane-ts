import type {
  ActionRequest,
  AvailableCard,
  CardData,
  HelpInfo,
  LoginOptions,
  MemberWithPresence,
  NotificationMessage,
  PointCard,
  ProcessSummary,
  ProductInfo,
  QueuedAction,
  ReplyData,
  ScenarioInfo,
  ServerPush,
  SessionData,
  StateData,
  ValidationResult,
  WorkflowSummary,
} from "@imane/shared";

const TOKEN_KEY = "imane.session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ストレージが使えない環境ではリロードでログアウトする
  }
}

export const hasToken = () => getToken() !== null;

async function send(method: string, path: string, body?: BodyInit | object, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    payload = body as BodyInit;
    headers["Content-Type"] = contentType ?? "application/octet-stream";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { method, headers, body: payload, cache: "no-store" });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const json = (await res.json()) as { message?: string };
      if (json.message) message = json.message;
    } catch {
      // 本文が JSON でない
    }
    if (res.status === 401 && path !== "/api/session") setToken(null);
    throw new ApiError(res.status, message);
  }
  return res;
}

async function json<T>(method: string, path: string, body?: BodyInit | object): Promise<T> {
  const res = await send(method, path, body);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

/** レスポンスをファイルとして保存する */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await send("GET", path);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const name = m?.[1] ? decodeURIComponent(m[1]) : fallbackName;
  saveBlob(await res.blob(), name);
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  product: () => json<ProductInfo>("GET", "/api/product"),
  loginOptions: () => json<LoginOptions>("GET", "/api/login-options"),

  async login(userid: string, password: string): Promise<SessionData> {
    const s = await json<SessionData>("POST", "/api/session", { userid, password: password || undefined });
    setToken(s.sessionkey);
    return s;
  },
  async logout(): Promise<void> {
    try {
      await json<void>("DELETE", "/api/session");
    } finally {
      setToken(null);
    }
  },
  session: () => json<SessionData>("GET", "/api/session"),

  actions: () => json<AvailableCard[]>("GET", "/api/actions"),
  allActions: () => json<AvailableCard[]>("GET", "/api/actions?all"),
  act: (req: ActionRequest) => json<{ id: string }>("POST", "/api/actions", req),
  states: () => json<StateData[]>("GET", "/api/states"),
  help: () => json<HelpInfo>("GET", "/api/help"),

  workflow: (team: string) => json<WorkflowSummary>("GET", `/api/teams/${enc(team)}/workflow`),
  history: (team: string) => json<NotificationMessage[]>("GET", `/api/teams/${enc(team)}/history`),
  members: (team: string) => json<MemberWithPresence[]>("GET", `/api/teams/${enc(team)}/members`),

  processes: () => json<ProcessSummary[]>("GET", "/api/processes"),
  start: (team: string, phase: number) => json<WorkflowSummary>("POST", `/api/teams/${enc(team)}/start`, { phase }),
  abort: (team: string) => json<WorkflowSummary>("POST", `/api/teams/${enc(team)}/abort`),
  resume: (team: string) => json<WorkflowSummary>("POST", `/api/teams/${enc(team)}/resume`),
  queue: (team: string) => json<QueuedAction[]>("GET", `/api/teams/${enc(team)}/queue`),
  triggers: (team: string) => json<ReplyData[]>("GET", `/api/teams/${enc(team)}/triggers`),
  systemStates: (team: string) => json<StateData[]>("GET", `/api/teams/${enc(team)}/system-states`),
  replies: (phase: number) => json<ReplyData[]>("GET", `/api/replies?phase=${phase}`),
  points: (phase: number) => json<PointCard[]>("GET", `/api/points?phase=${phase}`),

  saveSnapshots: (team?: string) =>
    download(`/api/snapshots${team ? `?team=${enc(team)}` : ""}`, `workflow.${team ?? "all"}.json`),
  restoreSnapshots: (data: unknown) => json<ProcessSummary[]>("POST", "/api/snapshots", data as object),

  scenarios: () => json<ScenarioInfo[]>("GET", "/api/scenarios"),
  activateScenario: (name: string) => json<ScenarioInfo[]>("POST", "/api/scenarios/active", { name }),
  validateScenario: (name: string) => json<ValidationResult[]>("GET", `/api/scenarios/${enc(name)}/validate`),
  downloadScenario: (name: string) => download(`/api/scenarios/${enc(name)}/archive`, `${name}.zip`),
  uploadScenarioArchive: (name: string, file: Blob) =>
    json<{ installed: boolean; validation: ValidationResult[] }>("PUT", `/api/scenarios/${enc(name)}/archive`, file),
  uploadScenarioFile: (name: string, filename: string, file: Blob) =>
    json<ValidationResult[]>("PUT", `/api/scenarios/${enc(name)}/files/${enc(filename)}`, file),
};

export type { CardData };

/** サーバからのプッシュ通知を受け取る。切断されたら onClose を呼ぶ */
export function connectEvents(onPush: (p: ServerPush) => void, onClose: () => void): () => void {
  const token = getToken();
  if (!token) return () => {};
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/notification?token=${enc(token)}`);
  let closedByUser = false;
  ws.onmessage = (ev) => {
    try {
      onPush(JSON.parse(String(ev.data)) as ServerPush);
    } catch {
      // 不正なメッセージは無視
    }
  };
  ws.onclose = () => {
    if (!closedByUser) onClose();
  };
  return () => {
    closedByUser = true;
    ws.close();
  };
}
