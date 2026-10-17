import {
  evaluateCondition,
  isBroadcastRole,
  isSystemUser,
  MEMBER_SYSTEM,
  MEMBER_TEAM,
  memberMatchesRole,
  MESSAGE_LEVEL,
  type CardData,
  type NotificationMessage,
  type Operator,
  type PointCard,
  type PublicMember,
  type QueuedAction,
  type ReplyData,
  type StateData,
  type TriggerEvent,
  type WorkflowState,
  type WorkflowSummary,
} from "@imane/shared";
import { badRequest, conflict } from "../errors";
import { createLogger } from "../logger";
import type { Scenario } from "../scenario/loader";
import { memberByRole, teamMembers } from "../scenario/members";
import { errorReply, findReplies, isTriggerReply, nullReply, repliesForPhase, REPLY_TYPE } from "./replies";

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface WorkflowDeps {
  scenario: () => Scenario;
  clock: Clock;
  /** イベントを参加者に配信する */
  publish: (msg: NotificationMessage) => void;
  newId?: () => string;
}

interface PendingAutoAction {
  card: CardData;
  from: PublicMember;
  to: PublicMember;
  cc: PublicMember[];
  fireAt: number;
}

export interface WorkflowSnapshot {
  format: "imane-workflow";
  version: 1;
  scenario: string;
  team: string;
  pid: number;
  phase: number;
  state: WorkflowState;
  start?: number;
  savedAt: number;
  score: number;
  history: NotificationMessage[];
  queue: QueuedAction[];
  systemState: Record<string, number>;
  triggerEvents: TriggerEvent[];
  autoActionHistory: Record<string, number>;
  pendingAutoActions: Array<{ cardId: string; fromRole: string; toRole: string; ccRoles: string[]; fireAt: number }>;
  memberStates: Record<string, string[]>;
  pointHistory: Record<string, string[]>;
  pointchest: Record<string, PointCard[]>;
}

const NOTIFICATION_FALLBACK: CardData = { id: "s0000", type: "notification", name: "通知", hidden: true };

/** 返信元として埋め込むイベント。入れ子が際限なく深くならないよう replyTo の replyTo は落とす */
function asReplySource(m: NotificationMessage): NotificationMessage {
  const { replyTo: _drop, ...rest } = m;
  return rest;
}

const log = createLogger("workflow");

/**
 * チームごとの演習ワークフローの状態(アクションキュー、履歴、システムステートなど)を管理する。
 * 時間経過に伴う処理は tick() で行う。
 */
export class WorkflowInstance {
  phase = 0;
  state: WorkflowState = "None";
  start?: number;
  score = 0;
  private suspendedAt?: number;

  private queue: QueuedAction[] = [];
  private history: NotificationMessage[] = [];
  /** システムステート: ステートID -> 登録日時 */
  private systemState = new Map<string, number>();
  private triggerEvents: TriggerEvent[] = [];
  private autoActionHistory = new Map<string, number>();
  private pendingAuto = new Map<string, PendingAutoAction>();
  /** ユーザの所有ステート: email -> ステートID */
  private memberStates = new Map<string, Set<string>>();
  /** ポイントカードID -> 発行の引き金になったイベントID */
  private pointHistory = new Map<string, string[]>();
  /** イベントID -> 獲得したポイントカード */
  private pointchest = new Map<string, PointCard[]>();
  /** 同じ警告を毎秒出さないための記録 */
  private warned = new Set<string>();

  constructor(
    readonly team: string,
    readonly pid: number,
    private readonly deps: WorkflowDeps,
  ) {}

  private get scenario(): Scenario {
    return this.deps.scenario();
  }

  private now(): number {
    return this.deps.clock.now();
  }

  private newId(): string {
    return this.deps.newId?.() ?? crypto.randomUUID();
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    log.warn(`${this.team}: ${message}`);
  }

  isRunning(): boolean {
    return this.state === "Started";
  }

  // ------------------------------------------------------------------ lifecycle

  /** フェーズを開始する。実行中なら例外 */
  startPhase(phase: number): void {
    if (this.isRunning()) {
      throw conflict("フェーズの実行中はフェーズを開始できません。実行中のフェーズを中止してください。");
    }
    this.phase = phase;
    this.state = "Started";
    this.score = 0;
    this.start = this.now();
    this.suspendedAt = undefined;
    this.queue = [];
    this.history = [];
    this.triggerEvents = [];
    this.systemState.clear();
    this.autoActionHistory.clear();
    this.pendingAuto.clear();
    this.pointHistory.clear();
    this.pointchest.clear();
    this.warned.clear();
    this.memberStates = new Map(teamMembers(this.scenario, this.team).map((m) => [m.email, new Set<string>()]));
    log.info(`${this.team}: フェーズ${phase}を開始しました。`);
  }

  /** フェーズを中断する。チームに通知してから停止する */
  abort(): void {
    if (this.state === "None" || this.state === "Aborted") return;
    this.postTeamNotification("演習ワークフローが中断されました。", MESSAGE_LEVEL.HIDDEN);
    this.state = "Aborted";
    this.pendingAuto.clear();
    log.info(`${this.team}: フェーズ${this.phase}を中断しました。`);
  }

  suspend(): void {
    if (!this.isRunning()) return;
    this.state = "Suspended";
    this.suspendedAt = this.now();
  }

  /** 一時停止または中断から再開する。一時停止していた時間は経過時間に含めない */
  resume(): void {
    if (this.phase <= 0 || this.isRunning()) return;
    if (this.state === "Suspended" && this.suspendedAt !== undefined) {
      this.shiftTimes(this.now() - this.suspendedAt);
    }
    this.suspendedAt = undefined;
    this.state = "Started";
    log.info(`${this.team}: フェーズ${this.phase}を再開しました。`);
  }

  // ------------------------------------------------------------------ messages

  private newMessage(
    action: CardData,
    to: PublicMember,
    from: PublicMember,
    cc?: PublicMember[],
    replyTo?: NotificationMessage,
  ): NotificationMessage {
    return {
      id: `${this.pid}-${this.newId()}`,
      processId: this.pid,
      team: this.team,
      sentDate: this.now(),
      level: MESSAGE_LEVEL.TRACE,
      message: action.message ?? "",
      action,
      to,
      from,
      cc: cc && cc.length > 0 ? cc : undefined,
      replyTo: replyTo ? asReplySource(replyTo) : undefined,
    };
  }

  /** 履歴に追加し、所有ステートを更新して配信する */
  private deliver(msg: NotificationMessage): void {
    // 自動応答ユーザからのリプライには Cc を付けない
    if (msg.reply && isSystemUser(msg.from, this.phase)) msg.cc = undefined;
    this.updateMemberStates(msg);
    this.history.push(msg);
    this.deps.publish(msg);
  }

  /** システムからチーム全員への通知 */
  postTeamNotification(message: string, level: number = MESSAGE_LEVEL.NORMAL): NotificationMessage {
    const card = structuredClone(this.notificationCard());
    const msg = this.newMessage(card, MEMBER_TEAM, MEMBER_SYSTEM);
    msg.message = message;
    msg.level = level;
    msg.replyDate = this.now();
    this.deliver(msg);
    return msg;
  }

  private notificationCard(): CardData {
    return this.scenario.actions.find((a) => a.type === "notification") ?? NOTIFICATION_FALLBACK;
  }

  // ------------------------------------------------------------------ states

  private hasState(id: string): boolean {
    return this.systemState.has(id);
  }

  /** システムステート条件を評価する。書式エラーは偽として扱う */
  private systemCondition(cond: readonly string[] | undefined, op: Operator): boolean {
    try {
      return evaluateCondition(cond, op, (id) => this.hasState(id));
    } catch (e) {
      this.warnOnce(`cond:${cond?.join(",")}`, `ステート条件の書式が不正です。${(e as Error).message}`);
      return false;
    }
  }

  private memberCondition(email: string, cond: readonly string[] | undefined, op: Operator): boolean {
    const owned = this.memberStates.get(email);
    try {
      return evaluateCondition(cond, op, (id) => owned?.has(id) ?? false);
    } catch (e) {
      this.warnOnce(`cond:${cond?.join(",")}`, `ステート条件の書式が不正です。${(e as Error).message}`);
      return false;
    }
  }

  private addState(id: string, msgId: string): void {
    if (!this.scenario.states.some((s) => s.id === id)) {
      this.warnOnce(`state:${id}`, `定義されていないシステムステートを追加します: ${id}`);
    }
    this.systemState.set(id, this.now());
    this.evaluateScore(id, msgId);
  }

  private applyStateChanges(src: { addstate?: string[]; removestate?: string[] }, msgId: string): void {
    for (const id of src.addstate ?? []) this.addState(id, msgId);
    for (const id of src.removestate ?? []) this.systemState.delete(id);
  }

  /** イベントで通知されたステートカードを、受け取ったメンバの所有ステートに加える */
  private updateMemberStates(msg: NotificationMessage): void {
    const states = new Set([...(msg.action.attachments ?? []), ...(msg.action.statecards ?? [])]);
    if (msg.reply?.state) states.add(msg.reply.state);
    if (states.size === 0) return;

    const recipients = isBroadcastRole(msg.to.role)
      ? teamMembers(this.scenario, this.team).map((m) => m.email)
      : [msg.to.email, msg.from.email, ...(msg.cc ?? []).map((c) => c.email)];
    for (const email of recipients) {
      if (!email) continue;
      const owned = this.memberStates.get(email) ?? new Set<string>();
      for (const s of states) owned.add(s);
      this.memberStates.set(email, owned);
    }
  }

  ownedStates(email: string): string[] {
    return [...(this.memberStates.get(email) ?? [])];
  }

  // ------------------------------------------------------------------ actions

  /**
   * アクション要求を受け付ける。
   * 宛先が自動応答ユーザで種類が action の場合はキューに入れ、それ以外は即時に配信する。
   */
  requestAction(card: CardData, from: PublicMember, to: PublicMember, cc: PublicMember[], replyTo?: NotificationMessage): NotificationMessage {
    if (!this.isRunning()) throw badRequest("このアクションは実行できません。演習が実行されていません。");

    const msg = this.newMessage(card, to, from, cc, replyTo);
    if (!isSystemUser(to, this.phase) || card.type.toLowerCase() !== "action") {
      msg.replyDate = this.now();
      this.applyStateChanges(card, msg.id);
      this.deliver(msg);
      return msg;
    }
    if (card.abortaction && this.countQueued([card.abortaction]) === 0) {
      throw badRequest("このアクションは実行できません。アクションが実行中でないため、中止することはできません。");
    }
    this.enqueue(msg);
    return msg;
  }

  private enqueue(msg: NotificationMessage): void {
    this.queue.push({ message: msg, order: 0 });
    this.deliver(msg);
  }

  findEvent(id: string): NotificationMessage | undefined {
    return this.history.find((m) => m.id === id);
  }

  private countQueued(actionIds: readonly string[]): number {
    return this.queue.filter((q) => actionIds.includes(q.message.action.id)).length;
  }

  /** 履歴上でアクションが実行されてからの経過秒数。未実行なら -1 */
  private elapsedSince(actionId: string): number {
    const m = this.history.find((h) => h.action.id === actionId);
    if (!m) return -1;
    return Math.floor((this.now() - (m.replyDate ?? m.sentDate)) / 1000);
  }

  // ------------------------------------------------------------------ tick

  /** 定期処理: 自動アクション、トリガーイベント、キューの順に評価する */
  tick(): void {
    if (!this.isRunning()) return;
    for (const [name, step] of [
      ["自動アクション", () => this.processAutoActions()],
      ["トリガーイベント", () => this.processTriggerEvents()],
      ["アクションキュー", () => this.dispatchQueue()],
    ] as const) {
      try {
        step();
      } catch (e) {
        log.error(`${this.team}: ${name}の処理に失敗しました。`, e);
      }
    }
  }

  /**
   * 自動アクションの起動条件。ユーザステート条件(statecondition, AND)と
   * システムステート条件(systemstatecondition, OR)の、指定されているほうのいずれかが成立すれば真。
   */
  private autoActionReady(card: CardData, from: PublicMember): boolean {
    const hasMemberCond = (card.statecondition?.length ?? 0) > 0;
    const hasSystemCond = (card.systemstatecondition?.length ?? 0) > 0;
    if (!hasMemberCond && !hasSystemCond) return true;
    if (hasMemberCond && this.memberCondition(from.email, card.statecondition, "AND")) return true;
    return hasSystemCond && this.systemCondition(card.systemstatecondition, "OR");
  }

  private processAutoActions(): void {
    const now = this.now();
    for (const card of this.scenario.actions) {
      if (card.type !== "auto" || this.autoActionHistory.has(card.id) || this.pendingAuto.has(card.id)) continue;
      const from = memberByRole(this.scenario, this.team, card.from ?? MEMBER_SYSTEM.role);
      const to = memberByRole(this.scenario, this.team, card.to ?? MEMBER_TEAM.role);
      if (!from || !to) {
        this.warnOnce(`auto:${card.id}`, `自動アクションの from/to に指定されたロールが定義されていません: ${card.id}`);
        continue;
      }
      if (!this.autoActionReady(card, from)) continue;
      const cc = (card.cc ?? []).map((r) => memberByRole(this.scenario, this.team, r)).filter((m) => m !== undefined);
      this.pendingAuto.set(card.id, { card, from, to, cc, fireAt: now + (card.delay ?? 5) * 1000 });
      log.info(`${this.team}: 自動アクションを受付: ${card.name} (${card.delay ?? 5}秒後)`);
    }

    for (const [id, p] of this.pendingAuto) {
      if (p.fireAt > now) continue;
      this.pendingAuto.delete(id);
      this.autoActionHistory.set(id, now);
      log.info(`${this.team}: 自動アクションを実行: ${p.card.name}`);
      this.enqueue(this.newMessage(structuredClone(p.card), p.to, p.from, p.cc));
    }
  }

  private triggerFired(state: string, toRole: string): boolean {
    return this.triggerEvents.some((e) => e.state === state && e.to === toRole);
  }

  /** フェーズ開始からの経過時間で発火するイベント */
  private processTriggerEvents(): void {
    const now = this.now();
    const start = this.start ?? now;
    for (const r of repliesForPhase(this.scenario, this.phase)) {
      if (!isTriggerReply(r) || (r.elapsed ?? -1) < 0) continue;
      if (now <= start + (r.elapsed ?? 0) * 1000) continue;
      if (!r.state) {
        this.warnOnce(`trigger:${r.name}`, `トリガーイベントにステートカードが設定されていません: ${r.name ?? ""}`);
        continue;
      }
      const to = memberByRole(this.scenario, this.team, r.to) ?? MEMBER_TEAM;
      const from = memberByRole(this.scenario, this.team, r.from) ?? MEMBER_SYSTEM;
      if (this.triggerFired(r.state, to.role)) continue;
      if (!this.systemCondition(r.statecondition, "OR")) continue;

      const card = structuredClone(this.notificationCard());
      card.statecards = [...new Set([...(card.statecards ?? []), r.state])];
      const msg = this.newMessage(card, to, from);
      msg.message = r.message ?? "";
      msg.replyDate = now;
      this.applyStateChanges(r, msg.id);
      for (const state of card.statecards) {
        if (!this.triggerFired(state, to.role)) this.triggerEvents.push({ state, date: now, from: from.role, to: to.role });
      }
      this.deliver(msg);
      log.info(`${this.team}: トリガーイベントを送信しました: ${r.name ?? ""} -> ${to.role}`);
    }
  }

  /** リプライが適用条件を満たすか */
  private replyApplicable(r: ReplyData): boolean {
    if (!this.systemCondition(r.statecondition, "OR")) return false;
    if (r.cardcondition?.some((id) => this.elapsedSince(id) < 0)) return false;
    for (const t of r.timecondition ?? []) {
      if (t.prerequisite === undefined || t.elapsed === undefined) continue;
      if (t.elapsed > this.elapsedSince(t.prerequisite)) return false;
    }
    const ids = r.constraints?.actionid;
    const multiplicity = r.constraints?.multiplicity;
    if (ids && multiplicity !== undefined && this.countQueued(ids) <= multiplicity) return false;
    return true;
  }

  /** キュー内のアクションに対するリプライを決める。保留する場合は undefined */
  private selectReply(entry: QueuedAction): ReplyData | undefined {
    const n = entry.message;
    const query = { phase: this.phase, actionId: n.action.id, to: n.to, order: entry.order, attachments: n.action.attachments };
    const candidates = findReplies(this.scenario, query);
    if (candidates.length === 0) {
      return isSystemUser(n.to, this.phase) ? errorReply(this.scenario, this.phase) : nullReply(this.scenario, this.phase);
    }
    const sorted = [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const found = sorted.find((r) => this.replyApplicable(r));
    return found ? structuredClone(found) : undefined;
  }

  /** 後続のリプライがなければ true */
  private isLastReply(entry: QueuedAction, replier: PublicMember): boolean {
    const n = entry.message;
    const next = findReplies(this.scenario, {
      phase: this.phase,
      actionId: n.action.id,
      to: replier,
      order: entry.order + 1,
      attachments: n.action.attachments,
    });
    return next.length === 0 || next.some((r) => r.type === REPLY_TYPE.NOT_FOUND);
  }

  private dispatchQueue(): void {
    for (const entry of [...this.queue]) {
      if (!this.queue.includes(entry)) continue; // 同じ周回で中止された
      const n = entry.message;
      const reply = this.selectReply(entry);
      if (!reply) continue;
      if (this.now() < n.sentDate + (reply.delay ?? 0) * 1000) continue;

      const rep = this.newMessage(n.action, n.from, n.to, n.cc, n);
      rep.sentDate = n.sentDate;
      rep.replyDate = this.now();
      rep.reply = reply;
      this.applyStateChanges(n.action, rep.id);
      this.applyStateChanges(reply, rep.id);
      this.deliver(rep);

      if (reply.abort || this.isLastReply(entry, rep.from)) {
        this.queue = this.queue.filter((q) => q !== entry);
      } else {
        entry.order++;
      }
      this.processAbortAction(entry);
    }
  }

  /** 中止系アクションのリプライを返したら、中止対象のアクションをキューから除く */
  private processAbortAction(source: QueuedAction): void {
    const target = source.message.action.abortaction;
    if (!target) return;
    const idx = this.queue.findIndex((q) => q !== source && q.message.action.id === target);
    if (idx === -1) {
      log.warn(`${this.team}: 中止対象アクションがキューにありません: ${target}`);
      return;
    }
    log.info(`${this.team}: アクションを中止しました: ${target}`);
    this.queue.splice(idx, 1);
  }

  // ------------------------------------------------------------------ points

  private evaluateScore(state: string, msgId: string): void {
    for (const card of this.scenario.points) {
      if (card.phase !== undefined && card.phase !== -1 && card.phase !== this.phase) continue;
      if (!this.pointApplicable(state, card)) continue;
      this.score += card.point ?? 0;
      this.pointHistory.set(card.id, [...(this.pointHistory.get(card.id) ?? []), msgId]);
      this.pointchest.set(msgId, [...(this.pointchest.get(msgId) ?? []), card]);
      log.info(`${this.team}: ポイントカードを取得: ${card.name ?? card.id} (${card.point ?? 0})`);
    }
  }

  private pointApplicable(state: string, card: PointCard): boolean {
    if (!this.isRunning() || this.start === undefined) return false;
    if (card.state !== undefined && card.state !== state) return false;
    if ((this.pointHistory.get(card.id)?.length ?? 0) >= (card.multiplicity ?? 1)) return false;
    const elapsed = (this.now() - this.start) / 1000;
    if (card.before && elapsed > card.before) return false;
    if (card.after && elapsed < card.after) return false;
    return !card.statecondition || this.systemCondition(card.statecondition, "AND");
  }

  // ------------------------------------------------------------------ queries

  summary(): WorkflowSummary {
    const timelimit = this.scenario.setting.phases.find((p) => p.phase === this.phase)?.timelimit;
    return {
      pid: this.pid,
      team: this.team,
      scenario: this.scenario.name,
      phase: this.phase,
      state: this.state,
      start: this.start,
      score: this.score,
      timelimit,
      autoActionHistory: Object.fromEntries(this.autoActionHistory),
      pointchest: Object.fromEntries(this.pointchest),
    };
  }

  /** イベント履歴。role を指定するとそのロールが送受信したイベントだけを返す */
  historyFor(role?: string): NotificationMessage[] {
    if (role === undefined) return [...this.history];
    return this.history.filter(
      (m) => memberMatchesRole(m.to, role) || m.from.role === role || (m.cc ?? []).some((c) => c.role === role),
    );
  }

  queueEntries(): QueuedAction[] {
    return this.queue.map((q) => ({ ...q }));
  }

  /** 現在のフェーズのトリガーイベント定義と発火日時 */
  triggers(): ReplyData[] {
    return repliesForPhase(this.scenario, this.phase)
      .filter(isTriggerReply)
      .map((r) => ({ ...r, fireWhen: this.triggerEvents.find((e) => e.state === r.state)?.date }));
  }

  systemStates(): StateData[] {
    return this.scenario.states.map((s) => ({ ...s, when: this.systemState.get(s.id) }));
  }

  // ------------------------------------------------------------------ snapshot

  private shiftTimes(diff: number): void {
    if (diff === 0) return;
    const shiftMsg = (m: NotificationMessage | undefined) => {
      if (!m) return;
      m.sentDate += diff;
      if (m.replyDate !== undefined) m.replyDate += diff;
      if (m.reply?.fireWhen !== undefined) m.reply.fireWhen += diff;
      shiftMsg(m.replyTo);
    };
    const shifted = new Set<NotificationMessage>();
    for (const m of [...this.history, ...this.queue.map((q) => q.message)]) {
      if (shifted.has(m)) continue;
      shifted.add(m);
      shiftMsg(m);
    }
    for (const [k, v] of this.systemState) this.systemState.set(k, v + diff);
    for (const e of this.triggerEvents) e.date += diff;
    for (const p of this.pendingAuto.values()) p.fireAt += diff;
    if (this.start !== undefined) this.start += diff;
  }

  snapshot(): WorkflowSnapshot {
    return structuredClone({
      format: "imane-workflow",
      version: 1,
      scenario: this.scenario.name,
      team: this.team,
      pid: this.pid,
      phase: this.phase,
      state: this.state,
      start: this.start,
      savedAt: this.suspendedAt ?? this.now(),
      score: this.score,
      history: this.history,
      queue: this.queue,
      systemState: Object.fromEntries(this.systemState),
      triggerEvents: this.triggerEvents,
      autoActionHistory: Object.fromEntries(this.autoActionHistory),
      pendingAutoActions: [...this.pendingAuto.values()].map((p) => ({
        cardId: p.card.id,
        fromRole: p.from.role,
        toRole: p.to.role,
        ccRoles: p.cc.map((c) => c.role),
        fireAt: p.fireAt,
      })),
      memberStates: Object.fromEntries([...this.memberStates].map(([k, v]) => [k, [...v]])),
      pointHistory: Object.fromEntries(this.pointHistory),
      pointchest: Object.fromEntries(this.pointchest),
    } satisfies WorkflowSnapshot);
  }

  /**
   * スナップショットから状態を復元する。保存時から現在までの時間だけ日時をずらし、一時停止状態にする。
   */
  static restore(s: WorkflowSnapshot, pid: number, deps: WorkflowDeps): WorkflowInstance {
    if (s?.format !== "imane-workflow" || s.version !== 1) throw badRequest("ワークフローデータの形式が不正です。");
    const inst = new WorkflowInstance(s.team, pid, deps);
    const data = structuredClone(s);
    inst.phase = data.phase;
    inst.start = data.start;
    inst.score = data.score;
    inst.history = data.history;
    const byId = new Map(inst.history.map((m) => [m.id, m]));
    inst.queue = data.queue.map((q) => ({ order: q.order, message: byId.get(q.message.id) ?? q.message }));
    inst.systemState = new Map(Object.entries(data.systemState));
    inst.triggerEvents = data.triggerEvents;
    inst.autoActionHistory = new Map(Object.entries(data.autoActionHistory));
    inst.memberStates = new Map(Object.entries(data.memberStates).map(([k, v]) => [k, new Set(v)]));
    inst.pointHistory = new Map(Object.entries(data.pointHistory));
    inst.pointchest = new Map(Object.entries(data.pointchest));

    const scenario = deps.scenario();
    for (const p of data.pendingAutoActions) {
      const card = scenario.actions.find((a) => a.id === p.cardId);
      const from = memberByRole(scenario, s.team, p.fromRole);
      const to = memberByRole(scenario, s.team, p.toRole);
      if (!card || !from || !to) continue;
      const cc = p.ccRoles.map((r) => memberByRole(scenario, s.team, r)).filter((m) => m !== undefined);
      inst.pendingAuto.set(card.id, { card, from, to, cc, fireAt: p.fireAt });
    }

    inst.shiftTimes(deps.clock.now() - data.savedAt);
    inst.state = data.phase > 0 ? "Suspended" : "None";
    inst.suspendedAt = inst.state === "Suspended" ? deps.clock.now() : undefined;
    return inst;
  }
}
