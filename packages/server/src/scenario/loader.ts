import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CardData,
  PhaseData,
  PointCard,
  ProductInfo,
  PublicMember,
  ReplyData,
  ScenarioSetting,
  StateData,
  TeamDef,
} from "@imane/shared";
import { readJsonFile, ScenarioFileError } from "./text";

/** サーバ内部でのみ扱うメンバ(パスワードハッシュを含む) */
export interface Member extends PublicMember {
  team: string;
  passwd?: string;
}

export interface Scenario {
  /** シナリオセット名。"_default_" は格納先直下 */
  readonly name: string;
  readonly dir: string;
  readonly setting: ScenarioSetting;
  readonly actions: readonly CardData[];
  /** email -> Member */
  readonly members: ReadonlyMap<string, Member>;
  readonly states: readonly StateData[];
  /** フェーズ -> リプライ。-1 は全フェーズ */
  readonly replies: ReadonlyMap<number, readonly ReplyData[]>;
  readonly points: readonly PointCard[];
}

export const SCENARIO_FILES = {
  setting: "setting.json",
  contacts: "contacts.json",
  actions: "actions.json",
  replies: "replies.json",
  states: "states.json",
  points: "points.json",
} as const;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

const strArray = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x) => x !== null && x !== undefined).map(String);
};

const num = (v: unknown, fallback?: number): number | undefined => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const numArray = (v: unknown): number[] | undefined => {
  const s = strArray(v);
  return s?.map(Number).filter(Number.isFinite);
};

function requireArray(root: unknown, key: string, file: string): unknown[] {
  if (!isObj(root) || !Array.isArray(root[key])) {
    throw new ScenarioFileError(`"${key}" 配列がありません。`, file);
  }
  return root[key] as unknown[];
}

function optionalFile(dir: string, name: string): string | undefined {
  const p = join(dir, name);
  return existsSync(p) ? p : undefined;
}

// ---------------------------------------------------------------- setting

export function loadSetting(dir: string): ScenarioSetting {
  const file = join(dir, SCENARIO_FILES.setting);
  const root = readJsonFile(file);
  if (!isObj(root)) throw new ScenarioFileError("オブジェクトではありません。", file);

  const teams: TeamDef[] = [];
  for (const t of Array.isArray(root.teams) ? root.teams : []) {
    if (isObj(t) && t.id !== undefined && t.name !== undefined) {
      teams.push({ id: String(t.id), name: String(t.name) });
    }
  }
  const phases: PhaseData[] = [];
  for (const p of Array.isArray(root.phases) ? root.phases : []) {
    if (!isObj(p)) continue;
    const phase = num(p.phase);
    if (phase === undefined) continue;
    phases.push({
      ...(p as object),
      phase,
      description: str(p.description),
      timelimit: num(p.timelimit, 1200),
      endstate: numArray(p.endstate),
    });
  }
  phases.sort((a, b) => a.phase - b.phase);
  return { ...(root as object), teams, phases } as ScenarioSetting;
}

// ---------------------------------------------------------------- contacts

function normalizeMember(raw: unknown, file: string): Member {
  if (!isObj(raw)) throw new ScenarioFileError("メンバ定義がオブジェクトではありません。", file);
  const email = str(raw.email);
  const role = str(raw.role);
  const team = str(raw.team);
  if (!email || !role || !team) {
    throw new ScenarioFileError(`メンバ定義に email/role/team がありません: ${JSON.stringify(raw)}`, file);
  }
  const rolename = str(raw.rolename) ?? str(raw.name) ?? role;
  return {
    ...(raw as object),
    email,
    role,
    team,
    rolename,
    name: str(raw.name) ?? rolename,
    desc: str(raw.desc),
    system: Array.isArray(raw.system) ? raw.system.map((b) => b === true) : undefined,
    recipients: strArray(raw.recipients),
    order: num(raw.order, 0),
    isadmin: raw.isadmin === true,
    hidden: raw.hidden === true,
    passwd: str(raw.passwd),
  };
}

function readContacts(file: string): Member[] {
  return requireArray(readJsonFile(file), "contacts", file).map((m) => normalizeMember(m, file));
}

export function loadMembers(dir: string, sysDir: string): Map<string, Member> {
  const all = new Map<string, Member>();
  const sysFile = optionalFile(sysDir, SCENARIO_FILES.contacts);
  if (sysFile) for (const m of readContacts(sysFile)) all.set(m.email, m);
  for (const m of readContacts(join(dir, SCENARIO_FILES.contacts))) all.set(m.email, m);
  return all;
}

// ---------------------------------------------------------------- actions

function normalizeCard(raw: unknown, file: string): CardData {
  if (!isObj(raw)) throw new ScenarioFileError("アクション定義がオブジェクトではありません。", file);
  const id = str(raw.id);
  const type = str(raw.type);
  if (!id || !type) throw new ScenarioFileError(`アクション定義に id/type がありません: ${JSON.stringify(raw)}`, file);
  return {
    ...(raw as object),
    id,
    type,
    name: str(raw.name) ?? id,
    to: str(raw.to),
    from: str(raw.from),
    cc: strArray(raw.cc),
    roles: strArray(raw.roles),
    assignTo: strArray(raw.assignTo),
    phase: numArray(raw.phase),
    addstate: strArray(raw.addstate),
    removestate: strArray(raw.removestate),
    attachments: strArray(raw.attachments),
    statecondition: strArray(raw.statecondition),
    systemstatecondition: strArray(raw.systemstatecondition),
    recipients: strArray(raw.recipients),
    statecards: strArray(raw.statecards),
    abortaction: str(raw.abortaction),
    delay: num(raw.delay, 5),
    hidden: raw.hidden === true,
    attach: raw.attach === true,
  };
}

function readActions(file: string): CardData[] {
  return requireArray(readJsonFile(file), "actions", file).map((a) => normalizeCard(a, file));
}

/** シナリオ固有のアクションを優先し、既定アクション(sys)のうちIDが重複しないものを後ろに足す */
export function loadActions(dir: string, sysDir: string): CardData[] {
  const custom = readActions(join(dir, SCENARIO_FILES.actions));
  const sysFile = optionalFile(sysDir, SCENARIO_FILES.actions);
  const defaults = sysFile ? readActions(sysFile) : [];
  const seen = new Set<string>();
  const merged: CardData[] = [];
  for (const c of [...custom, ...defaults]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(c);
  }
  return merged;
}

// ---------------------------------------------------------------- replies

function normalizeReply(raw: unknown, file: string): ReplyData {
  if (!isObj(raw)) throw new ScenarioFileError("リプライ定義がオブジェクトではありません。", file);
  const timecondition = Array.isArray(raw.timecondition)
    ? raw.timecondition.filter(isObj).map((t) => ({ prerequisite: str(t.prerequisite), elapsed: num(t.elapsed) }))
    : undefined;
  const constraints = isObj(raw.constraints)
    ? { actionid: strArray(raw.constraints.actionid), multiplicity: num(raw.constraints.multiplicity) }
    : undefined;
  return {
    ...(raw as object),
    actionid: str(raw.actionid),
    to: str(raw.to),
    from: str(raw.from),
    type: str(raw.type),
    state: str(raw.state),
    attachmentcondition: str(raw.attachmentcondition),
    cardcondition: strArray(raw.cardcondition),
    statecondition: strArray(raw.statecondition),
    addstate: strArray(raw.addstate),
    removestate: strArray(raw.removestate),
    timecondition,
    constraints,
    delay: num(raw.delay, 0),
    order: num(raw.order, 0),
    elapsed: num(raw.elapsed, -1),
    priority: num(raw.priority, 0),
    level: num(raw.level, 0),
    abort: raw.abort === true,
  };
}

function readReplies(file: string): Map<number, ReplyData[]> {
  const byPhase = new Map<number, ReplyData[]>();
  for (const entry of requireArray(readJsonFile(file), "states", file)) {
    if (!isObj(entry)) continue;
    const phase = num(entry.phase);
    if (phase === undefined) throw new ScenarioFileError("リプライ定義に phase がありません。", file);
    if (!Array.isArray(entry.reply)) throw new ScenarioFileError(`フェーズ${phase}に reply 配列がありません。`, file);
    const list = byPhase.get(phase) ?? [];
    list.push(...entry.reply.map((r) => normalizeReply(r, file)));
    byPhase.set(phase, list);
  }
  return byPhase;
}

/** 既定リプライ(sys)を先に、シナリオ固有のリプライを後ろに並べる。-1 には全フェーズを格納する */
export function loadReplies(dir: string, sysDir: string): Map<number, ReplyData[]> {
  const custom = readReplies(join(dir, SCENARIO_FILES.replies));
  const sysFile = optionalFile(sysDir, SCENARIO_FILES.replies);
  const defaults = sysFile ? readReplies(sysFile) : new Map<number, ReplyData[]>();

  const merged = new Map<number, ReplyData[]>();
  for (const phase of new Set([...defaults.keys(), ...custom.keys()])) {
    merged.set(phase, [...(defaults.get(phase) ?? []), ...(custom.get(phase) ?? [])]);
  }
  merged.set(-1, [...merged.values()].flat());
  return merged;
}

// ---------------------------------------------------------------- states

function readStates(file: string): StateData[] {
  const root = readJsonFile(file);
  if (!Array.isArray(root)) throw new ScenarioFileError("ステート定義は配列である必要があります。", file);
  return root.filter(isObj).map((s) => {
    const id = str(s.id);
    if (!id) throw new ScenarioFileError(`ステート定義に id がありません: ${JSON.stringify(s)}`, file);
    return { ...(s as object), id, name: str(s.name) ?? `ステート(${id})`, type: num(s.type, 0) };
  });
}

export function loadStates(dir: string, sysDir: string): StateData[] {
  const sysFile = optionalFile(sysDir, SCENARIO_FILES.states);
  return [...(sysFile ? readStates(sysFile) : []), ...readStates(join(dir, SCENARIO_FILES.states))];
}

// ---------------------------------------------------------------- points

function readPoints(file: string): PointCard[] {
  return requireArray(readJsonFile(file), "pointcard", file)
    .filter(isObj)
    .map((p) => {
      const id = str(p.id);
      if (!id) throw new ScenarioFileError(`ポイントカードに id がありません: ${JSON.stringify(p)}`, file);
      return {
        ...(p as object),
        id,
        name: str(p.name) ?? "",
        description: str(p.description) ?? "",
        phase: num(p.phase, -1),
        before: num(p.before, 0),
        after: num(p.after, 0),
        state: str(p.state),
        statecondition: strArray(p.statecondition),
        multiplicity: num(p.multiplicity, 1),
        point: num(p.point, 0),
      };
    });
}

/** points.json は省略可能 */
export function loadPoints(dir: string, sysDir: string): PointCard[] {
  const files = [optionalFile(sysDir, SCENARIO_FILES.points), optionalFile(dir, SCENARIO_FILES.points)];
  const all = files.filter((f): f is string => f !== undefined).flatMap(readPoints);
  return all.sort((a, b) => (a.phase ?? -1) - (b.phase ?? -1));
}

// ---------------------------------------------------------------- all

export function loadScenario(name: string, dir: string, sysDir: string): Scenario {
  return {
    name,
    dir,
    setting: loadSetting(dir),
    actions: loadActions(dir, sysDir),
    members: loadMembers(dir, sysDir),
    states: loadStates(dir, sysDir),
    replies: loadReplies(dir, sysDir),
    points: loadPoints(dir, sysDir),
  };
}

export function loadProduct(sysDir: string): ProductInfo {
  const file = optionalFile(sysDir, "product.json");
  if (!file) return {};
  const root = readJsonFile(file);
  return isObj(root) ? (root as ProductInfo) : {};
}
