import { relative } from "node:path";
import { serveStatic, upgradeWebSocket } from "@hono/bun";
import {
  type ActionRequest,
  type AvailableCard,
  type CardData,
  ConditionSyntaxError,
  evaluateCondition,
  type HelpInfo,
  isSystemUser,
  type LoginOptions,
  MEMBER_TEAM,
  type ProductInfo,
  type PublicMember,
  ROLE_TEAM,
  type SessionData,
  specialMember,
} from "@imane/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type SessionStore, verifyPassword } from "./auth";
import type { WorkflowManager } from "./engine/manager";
import type { WorkflowInstance, WorkflowSnapshot } from "./engine/workflow";
import { badRequest, forbidden, HttpError, notFound, unauthorized } from "./errors";
import { createLogger } from "./logger";
import type { Notifier } from "./notifier";
import type { Member, Scenario } from "./scenario/loader";
import { memberByRole, teamMembers, toPublicMember } from "./scenario/members";
import type { ScenarioStore } from "./scenario/store";
import { ScenarioFileError } from "./scenario/text";

export interface AppContext {
  scenarios: ScenarioStore;
  manager: WorkflowManager;
  notifier: Notifier;
  sessions: SessionStore;
  product: ProductInfo;
  /** ビルド済みクライアントの格納先。未指定なら静的ファイルを配信しない */
  staticDir?: string;
  /** passwd 未設定の管理者のログインを許す(ローカルでの試用向け) */
  allowPasswordlessAdmin?: boolean;
}

interface AuthUser {
  key: string;
  member: Member;
}

type Env = { Variables: { user: AuthUser } };

const log = createLogger("http");
const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_MESSAGE = 10_000;

function sessionKey(c: Context): string | undefined {
  const auth = c.req.header("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : undefined;
}

function toSessionData(key: string, m: Member): SessionData {
  return {
    sessionkey: key,
    userid: m.email,
    username: m.name,
    role: m.role,
    rolename: m.rolename,
    team: m.team,
    isadmin: m.isadmin === true,
  };
}

async function jsonBody<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch (e) {
    throw badRequest("リクエストの形式が不正です。", e);
  }
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function parseActionRequest(raw: unknown): ActionRequest {
  const r = raw as Partial<ActionRequest> | null;
  if (!r || typeof r.actionId !== "string" || typeof r.to !== "string") {
    throw badRequest("パラメタが不正です。(actionId, to)");
  }
  if (r.cc !== undefined && !isStringArray(r.cc)) throw badRequest("パラメタが不正です。(cc)");
  if (r.attachments !== undefined && !isStringArray(r.attachments))
    throw badRequest("パラメタが不正です。(attachments)");
  if (r.replyTo !== undefined && typeof r.replyTo !== "string") throw badRequest("パラメタが不正です。(replyTo)");
  if (r.message !== undefined && (typeof r.message !== "string" || r.message.length > MAX_MESSAGE)) {
    throw badRequest("パラメタが不正です。(message)");
  }
  return r as ActionRequest;
}

function availableInPhase(card: CardData, phase: number): boolean {
  return !card.phase || card.phase.length === 0 || card.phase.includes(phase);
}

/** 参加者がアクションを使用できるか(フェーズとユーザステート条件) */
function cardAvailable(card: CardData, phase: number, owned: ReadonlySet<string>): boolean {
  if (!availableInPhase(card, phase)) return false;
  try {
    return evaluateCondition(card.statecondition, "AND", (id) => owned.has(id));
  } catch {
    return false;
  }
}

function cardHeldBy(card: CardData, role: string): boolean {
  return (card.roles ?? []).some((r) => r === ROLE_TEAM || r === role);
}

/** 参加者が自分で実行できる種類のアクションか */
function isUserAction(card: CardData): boolean {
  return !card.hidden && !["auto", "notification", "alert"].includes(card.type);
}

function teamMember(scenario: Scenario, team: string, role: string): PublicMember {
  const m = specialMember(role) ? undefined : memberByRole(scenario, team, role);
  if (!m) throw badRequest(`宛先が不正です: ${role}`);
  return m;
}

export function createApp(ctx: AppContext) {
  const { scenarios, manager, notifier, sessions } = ctx;
  const app = new Hono<Env>();

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const key = sessionKey(c);
    const userid = sessions.get(key);
    if (!key || !userid) throw unauthorized();
    const member = scenarios.current().members.get(userid);
    if (!member) {
      sessions.delete(key);
      throw unauthorized("ログイン中のユーザがシナリオに存在しません。再度ログインしてください。");
    }
    c.set("user", { key, member });
    await next();
  };

  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    if (!c.get("user").member.isadmin) throw forbidden();
    await next();
  };

  /** 自チームまたは管理者だけが参照できる */
  const teamOf = (c: Context<Env>): WorkflowInstance => {
    const team = c.req.param("team") ?? "";
    const user = c.get("user");
    if (!user.member.isadmin && user.member.team !== team) throw forbidden();
    return manager.get(team);
  };

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ status: err.status, message: err.message }, err.status);
    if (err instanceof ScenarioFileError || err instanceof ConditionSyntaxError) {
      return c.json({ status: 400, message: err.message }, 400);
    }
    log.error(`${c.req.method} ${c.req.path} の処理に失敗しました。`, err);
    return c.json({ status: 500, message: "サーバ内部でエラーが発生しました。" }, 500);
  });

  // ---------------------------------------------------------------- public

  app.get("/api/product", (c) => c.json(ctx.product));

  app.get("/api/login-options", (c) => {
    const scenario = scenarios.current();
    const members = [...scenario.members.values()].filter((m) => !isSystemUser(m, 1)).map(toPublicMember);
    return c.json({ teams: scenario.setting.teams, members } satisfies LoginOptions);
  });

  app.post("/api/session", async (c) => {
    const body = await jsonBody<{ userid?: unknown; password?: unknown }>(c);
    const userid = typeof body.userid === "string" ? body.userid : "";
    const password = typeof body.password === "string" ? body.password : undefined;
    const member = scenarios.current().members.get(userid);
    if (!member || !verifyPassword(member.passwd, password)) {
      throw unauthorized("ログオンに失敗しました。IDまたはパスワードが一致しません。");
    }
    if (member.isadmin && !member.passwd && !ctx.allowPasswordlessAdmin) {
      throw unauthorized("ファシリテータにはパスワードの設定が必要です。contacts.json の passwd を設定してください。");
    }
    const key = sessions.create(member.email);
    log.info(`ログイン: ${member.email}`);
    return c.json(toSessionData(key, member));
  });

  // ---------------------------------------------------------------- websocket

  app.get(
    "/api/notification",
    async (c, next) => {
      const userid = sessions.get(c.req.query("token"));
      if (!userid) return c.json({ status: 401, message: "ログインしていません。" }, 401);
      c.set("user", { key: "", member: { email: userid } as Member });
      await next();
    },
    upgradeWebSocket((c) => {
      const email = (c.get("user") as AuthUser).member.email;
      return {
        onOpen: (_evt, ws) => notifier.connect(email, ws),
        onClose: (_evt, ws) => notifier.disconnect(email, ws),
      };
    }),
  );

  // ---------------------------------------------------------------- participant

  app.use("/api/*", requireAuth);

  app.get("/api/session", (c) => {
    const { key, member } = c.get("user");
    return c.json(toSessionData(key, member));
  });

  app.delete("/api/session", (c) => {
    sessions.delete(c.get("user").key);
    return c.body(null, 204);
  });

  app.get("/api/actions", (c) => {
    const { member } = c.get("user");
    const scenario = scenarios.current();
    const inst = manager.get(member.team);
    if (member.isadmin && c.req.query("all") !== undefined) {
      return c.json(scenario.actions.map((a) => ({ ...a, available: availableInPhase(a, inst.phase) })));
    }
    const owned = new Set(inst.ownedStates(member.email));
    const cards: AvailableCard[] = scenario.actions
      .filter((a) => cardHeldBy(a, member.role))
      .map((a) => ({
        ...a,
        available: member.isadmin || cardAvailable(a, inst.phase, new Set([...owned, ...(a.attachments ?? [])])),
      }));
    return c.json(cards);
  });

  app.post("/api/actions", async (c) => {
    const { member } = c.get("user");
    const req = parseActionRequest(await jsonBody(c));
    const scenario = scenarios.current();
    const inst = manager.get(member.team);
    const card = scenario.actions.find((a) => a.id === req.actionId);
    if (!card) throw badRequest(`アクションが見つかりません: ${req.actionId}`);

    const owned = new Set([...inst.ownedStates(member.email), ...(card.attachments ?? [])]);
    if (!member.isadmin) {
      if (!cardHeldBy(card, member.role) || !isUserAction(card)) throw forbidden("このアクションは使用できません。");
      if (!cardAvailable(card, inst.phase, owned)) throw badRequest("このアクションは現在使用できません。");
    }

    const to = req.to === ROLE_TEAM && member.isadmin ? MEMBER_TEAM : teamMember(scenario, member.team, req.to);
    const cc = [...new Set(req.cc ?? [])].filter((r) => r !== to.role).map((r) => teamMember(scenario, member.team, r));
    const attachments = req.attachments ?? card.attachments;
    const knownStates = new Set(scenario.states.map((s) => s.id));
    for (const s of attachments ?? []) {
      if (member.isadmin ? !knownStates.has(s) : !owned.has(s)) throw badRequest(`添付できないステートです: ${s}`);
    }
    const replyTo = req.replyTo ? inst.findEvent(req.replyTo) : undefined;
    if (req.replyTo && !replyTo) throw badRequest("返信元のイベントが見つかりません。");

    const action: CardData = { ...structuredClone(card), message: req.message ?? card.message ?? "", attachments };
    const msg = inst.requestAction(action, toPublicMember(member), to, cc, replyTo);
    return c.json({ id: msg.id }, 202);
  });

  app.get("/api/states", (c) => c.json(scenarios.current().states));

  app.get("/api/help", (c) => {
    const scenario = scenarios.current();
    const { member } = c.get("user");
    const invisible = new Set(scenario.setting["invisible-action"] ?? []);
    const members = teamMembers(scenario, member.team).filter((m) => !m.hidden);
    const actions = scenario.actions
      .filter((a) => !a.hidden && a.type !== "auto" && !invisible.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description ?? "",
        holders: (a.roles ?? []).includes(ROLE_TEAM)
          ? ["すべてのユーザ"]
          : members.filter((m) => a.roles?.includes(m.role)).map((m) => m.rolename),
      }));
    const roles = members.map((m) => ({
      role: m.role,
      rolename: m.rolename,
      desc: m.desc ?? "",
      system: isSystemUser(m, 1),
    }));
    return c.json({ actions, roles } satisfies HelpInfo);
  });

  app.get("/api/teams/:team/workflow", (c) => c.json(teamOf(c).summary()));

  app.get("/api/teams/:team/history", (c) => {
    const inst = teamOf(c);
    const { member } = c.get("user");
    return c.json(inst.historyFor(member.isadmin ? c.req.query("role") : member.role));
  });

  app.get("/api/teams/:team/members", (c) => {
    const inst = teamOf(c);
    const { member } = c.get("user");
    const members = notifier.presence(inst.team);
    // 他のメンバの所有ステートは管理者にだけ見せる
    return c.json(
      member.isadmin ? members : members.map((m) => (m.email === member.email ? m : { ...m, availableStates: [] })),
    );
  });

  // ---------------------------------------------------------------- facilitator

  app.use("/api/processes", requireAdmin);
  app.use("/api/teams/:team/start", requireAdmin);
  app.use("/api/teams/:team/abort", requireAdmin);
  app.use("/api/teams/:team/resume", requireAdmin);
  app.use("/api/teams/:team/queue", requireAdmin);
  app.use("/api/teams/:team/triggers", requireAdmin);
  app.use("/api/teams/:team/system-states", requireAdmin);
  app.use("/api/replies", requireAdmin);
  app.use("/api/points", requireAdmin);
  app.use("/api/snapshots", requireAdmin);
  app.use("/api/scenarios", requireAdmin);
  app.use("/api/scenarios/*", requireAdmin);

  app.get("/api/processes", (c) => c.json(manager.processes()));

  app.post("/api/teams/:team/start", async (c) => {
    const body = await jsonBody<{ phase?: unknown; force?: unknown }>(c);
    const phase = Number(body.phase);
    if (!Number.isInteger(phase) || phase <= 0) throw badRequest("フェーズ番号が不正です。");
    return c.json(manager.start(c.req.param("team"), phase, body.force === true).summary());
  });

  app.post("/api/teams/:team/abort", (c) => {
    const inst = manager.get(c.req.param("team"));
    inst.abort();
    return c.json(inst.summary());
  });

  app.post("/api/teams/:team/resume", (c) => {
    const inst = manager.get(c.req.param("team"));
    inst.resume();
    return c.json(inst.summary());
  });

  app.get("/api/teams/:team/queue", (c) => c.json(teamOf(c).queueEntries()));
  app.get("/api/teams/:team/triggers", (c) => c.json(teamOf(c).triggers()));
  app.get("/api/teams/:team/system-states", (c) => c.json(teamOf(c).systemStates()));

  const phaseQuery = (c: Context) => {
    const p = Number(c.req.query("phase") ?? -1);
    return Number.isFinite(p) && p > 0 ? p : -1;
  };
  app.get("/api/replies", (c) => c.json(scenarios.current().replies.get(phaseQuery(c)) ?? []));
  app.get("/api/points", (c) => {
    const phase = phaseQuery(c);
    return c.json(scenarios.current().points.filter((p) => phase === -1 || p.phase === -1 || p.phase === phase));
  });

  app.get("/api/snapshots", (c) => {
    const team = c.req.query("team");
    const data = manager.snapshots(team && team !== "all" ? team : undefined);
    const name = `workflow.${team ?? "all"}.${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return c.json(data);
  });

  app.post("/api/snapshots", bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
    const body = await jsonBody<WorkflowSnapshot | WorkflowSnapshot[]>(c);
    manager.restore(Array.isArray(body) ? body : [body]);
    return c.json(manager.processes());
  });

  // ---------------------------------------------------------------- scenarios

  app.get("/api/scenarios", (c) => c.json(scenarios.list()));

  app.post("/api/scenarios/active", async (c) => {
    const body = await jsonBody<{ name?: unknown }>(c);
    if (typeof body.name !== "string" || body.name === "") throw badRequest("シナリオセットが指定されていません。");
    manager.switchScenario(body.name);
    notifier.broadcast({ type: "alert", message: "シナリオセットが変更されました。ページを再読み込みしてください。" });
    return c.json(scenarios.list());
  });

  app.get("/api/scenarios/:name/validate", (c) => c.json(scenarios.validate(c.req.param("name"))));

  app.get("/api/scenarios/:name/archive", (c) => {
    const name = c.req.param("name");
    const zip = scenarios.exportZip(name);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`);
    return c.body(zip as Uint8Array<ArrayBuffer>);
  });

  app.put("/api/scenarios/:name/archive", bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
    const data = new Uint8Array(await c.req.arrayBuffer());
    const result = scenarios.importZip(c.req.param("name"), data);
    return c.json(result, result.installed ? 200 : 400);
  });

  app.put("/api/scenarios/:name/files/:filename", bodyLimit({ maxSize: MAX_UPLOAD }), async (c) => {
    const data = new Uint8Array(await c.req.arrayBuffer());
    return c.json(scenarios.putFile(c.req.param("name"), c.req.param("filename"), data));
  });

  app.all("/api/*", () => {
    throw notFound("APIが見つかりません。");
  });

  // ---------------------------------------------------------------- static

  if (ctx.staticDir) {
    const root = relative(process.cwd(), ctx.staticDir) || ".";
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}
