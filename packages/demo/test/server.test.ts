import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { LoginOptions, ServerPush, SessionData } from "@imane/shared";
import { createDemoServer } from "../src/server";

const DATA_DIR = join(import.meta.dir, "..", "..", "server", "data");
const server = createDemoServer(DATA_DIR, 60_000);
afterAll(() => server.stop());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await server.fetch(
    new Request(`http://demo${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: res.status === 204 ? undefined : await res.json() };
}

async function loginAs(pick: (options: LoginOptions) => string): Promise<SessionData> {
  const options = (await call("GET", "/api/login-options")).json as LoginOptions;
  const r = await call("POST", "/api/session", undefined, { userid: pick(options) });
  expect(r.status).toBe(200);
  return r.json as SessionData;
}

const teamPath = (team: string, rest: string) => `/api/teams/${encodeURIComponent(team)}/${rest}`;

describe("createDemoServer", () => {
  test("パスワードのないファシリテータでログインできる", async () => {
    const admin = await loginAs((o) => o.members.find((m) => m.isadmin)!.email);
    expect(admin.isadmin).toBe(true);
    expect((await call("GET", "/api/processes", admin.sessionkey)).status).toBe(200);
  });

  test("有効なセションだけがプッシュ通知につながり、切断できる", async () => {
    const user = await loginAs((o) => o.members.find((m) => !m.isadmin)!.email);
    const received: ServerPush[] = [];
    const disconnect = server.connect(user.sessionkey, { send: (data) => received.push(JSON.parse(data)) });
    expect(disconnect).toBeFunction();
    expect(received.some((p) => p.type === "presence")).toBe(true);

    const online = (await call("GET", teamPath(user.team, "members"), user.sessionkey)).json;
    expect(online).toContainEqual(expect.objectContaining({ email: user.userid, online: true }));
    disconnect?.();
    const offline = (await call("GET", teamPath(user.team, "members"), user.sessionkey)).json;
    expect(offline).toContainEqual(expect.objectContaining({ email: user.userid, online: false }));

    expect(server.connect("invalid", { send: () => {} })).toBeUndefined();
  });

  test("ファシリテータが演習を開始でき、参加者が履歴を取得できる", async () => {
    const admin = await loginAs((o) => o.members.find((m) => m.isadmin)!.email);
    const user = await loginAs((o) => o.members.find((m) => !m.isadmin && m.team === admin.team)!.email);

    expect((await call("POST", teamPath(user.team, "start"), admin.sessionkey, { phase: 1 })).status).toBe(200);
    expect((await call("GET", teamPath(user.team, "history"), user.sessionkey)).status).toBe(200);
    expect((await call("GET", teamPath(user.team, "workflow"), user.sessionkey)).json).toMatchObject({ phase: 1 });
  });
});
