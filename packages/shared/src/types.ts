/**
 * シナリオデータとAPIで共有する型定義。
 * プロパティ名はシナリオJSON(actions.json 等)の既存フォーマットに合わせている。
 * 日時はすべて epoch ミリ秒。
 */

export const CARD_TYPES = ["action", "talk", "share", "notification", "auto", "alert"] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** 特殊ロール */
export const ROLE_SYSTEM = "system";
/** チーム全員 */
export const ROLE_TEAM = "all";
/** 全員(全チーム) */
export const ROLE_EVERYONE = "systemall";

/** アクションカード (actions.json) */
export interface CardData {
  id: string;
  type: CardType | string;
  name: string;
  /** auto のとき: 宛先ロール */
  to?: string;
  /** auto のとき: 送信元ロール */
  from?: string;
  /** auto のとき: 同報先ロール */
  cc?: string[];
  message?: string;
  description?: string;
  fixed?: boolean;
  /** 実行可能なロール ("all" で全員) */
  roles?: string[];
  assignTo?: string[];
  comment?: string;
  /** 使用可能なフェーズ。省略時は全フェーズ */
  phase?: number[];
  share?: boolean;
  addstate?: string[];
  removestate?: string[];
  attachments?: string[];
  /** 実行条件となるユーザ所有ステート */
  statecondition?: string[];
  hidden?: boolean;
  /** 実行条件となるシステムステート (auto) */
  systemstatecondition?: string[];
  /** auto: 条件成立から実行までの秒数。既定 5 */
  delay?: number;
  icon?: string;
  /** 新規アクションで選択可能な宛先ロール */
  recipients?: string[];
  /** トリガーイベントで添付されるステート */
  statecards?: string[];
  /** 中止系アクション: 中止するアクションID */
  abortaction?: string;
  /** ステートカードを添付可能 */
  attach?: boolean;
}

/** アクションに対する応答 (replies.json) */
export interface ReplyData {
  id?: string;
  actionid?: string;
  to?: string;
  from?: string;
  level?: number;
  name?: string;
  message?: string;
  /** これらのアクションが実行済であれば適用 */
  cardcondition?: string[];
  /** 前提アクション実行後の経過秒数条件 */
  timecondition?: Array<{ prerequisite?: string; elapsed?: number }>;
  /** 多重度制約 */
  constraints?: { actionid?: string[]; multiplicity?: number };
  /** 添付するステートカードID */
  state?: string;
  /** 応答までの待ち時間(秒) */
  delay?: number;
  /** 評価順 */
  order?: number;
  /** trueなら後続リプライを打ち切る */
  abort?: boolean;
  /** notfound | null | hidden | trigger */
  type?: string;
  /** トリガーイベント: フェーズ開始からの経過秒数 */
  elapsed?: number;
  statecondition?: string[];
  addstate?: string[];
  removestate?: string[];
  /** 添付ステート条件 */
  attachmentcondition?: string;
  /** 評価優先度(大きいほど優先) */
  priority?: number;
  fixed?: boolean;
  /** トリガーイベントが発火した日時(出力専用) */
  fireWhen?: number;
}

/** ステートカード (states.json) */
export interface StateData {
  id: string;
  name?: string;
  description?: string;
  /** 0:通常 1:フェーズ開始 2:フェーズ終了 3:フェーズ中断 */
  type?: number;
  fixed?: boolean;
  /** 演出効果。"href:相対URL" または "html:..." */
  effect?: string;
  icon?: string;
  /** システムステートに登録された日時(出力専用) */
  when?: number;
}

/** ポイントカード (points.json) */
export interface PointCard {
  id: string;
  name?: string;
  description?: string;
  /** -1 で全フェーズ */
  phase?: number;
  /** フェーズ開始からの経過秒数の上限。0 で無制限 */
  before?: number;
  /** フェーズ開始からの経過秒数の下限。0 で無制限 */
  after?: number;
  /** 対象となるシステムステート */
  state?: string;
  statecondition?: string[];
  multiplicity?: number;
  point?: number;
}

export interface PhaseData {
  phase: number;
  description?: string;
  timelimit?: number;
  endstate?: number[];
}

export interface TeamDef {
  id: string;
  name: string;
}

/** setting.json */
export interface ScenarioSetting {
  name?: string;
  description?: string;
  author?: string;
  copyright?: string;
  version?: string;
  created?: string;
  updated?: string;
  teams: TeamDef[];
  phases: PhaseData[];
  "invisible-action"?: string[];
  "roles-order"?: Array<{ role: string; order: number }>;
}

/** 演習参加者(contacts.json)。passwd はサーバ外に出さない */
export interface PublicMember {
  email: string;
  name: string;
  role: string;
  rolename: string;
  team?: string;
  desc?: string;
  /** フェーズごとの自動応答フラグ */
  system?: boolean[];
  hidden?: boolean;
  recipients?: string[];
  order?: number;
  isadmin?: boolean;
  icon?: string;
}

export interface MemberWithPresence extends PublicMember {
  online: boolean;
  /** 所有しているステートカードID */
  availableStates: string[];
}

/** 送受信されるイベント */
export interface NotificationMessage {
  id: string;
  processId: number;
  team: string;
  sentDate: number;
  replyDate?: number;
  level: number;
  message: string;
  action: CardData;
  to: PublicMember;
  from: PublicMember;
  cc?: PublicMember[];
  reply?: ReplyData;
  /** 返信元イベント(1段のみ。replyTo の replyTo は保持しない) */
  replyTo?: NotificationMessage;
}

export const MESSAGE_LEVEL = {
  TRACE: 0,
  NORMAL: 1,
  WARN: 2,
  CRITICAL: 3,
  EMERGENCY: 4,
  HIDDEN: 0x10,
} as const;

export type WorkflowState = "None" | "Started" | "Ended" | "Suspended" | "Aborted";

export interface TriggerEvent {
  state: string;
  date: number;
  from?: string;
  to: string;
}

/** ワークフロー状態の要約 */
export interface WorkflowSummary {
  pid: number;
  team: string;
  /** シナリオセット名 */
  scenario: string;
  phase: number;
  state: WorkflowState;
  start?: number;
  score: number;
  timelimit?: number;
  /** 自動アクションID -> 実行日時 */
  autoActionHistory: Record<string, number>;
  /** イベントID -> 獲得したポイントカード */
  pointchest: Record<string, PointCard[]>;
}

export interface ProcessSummary {
  pid: number;
  team: string;
  teamName: string;
  scenario: string;
  workflow: WorkflowSummary;
}

export interface SessionData {
  sessionkey: string;
  userid: string;
  username: string;
  role: string;
  rolename: string;
  team: string;
  isadmin: boolean;
}

export interface LoginOptions {
  teams: TeamDef[];
  /** ログイン可能な(自動応答でない)メンバ */
  members: PublicMember[];
}

/** 参加者向けのアクションカード。available はサーバで評価する */
export interface AvailableCard extends CardData {
  available: boolean;
}

export interface ActionRequest {
  /** 実行するアクションID */
  actionId: string;
  /** 宛先ロール。"all" でチーム全員(ファシリテータのみ) */
  to: string;
  cc?: string[];
  /** 返信元イベントID */
  replyTo?: string;
  /** 添付するステートカードID */
  attachments?: string[];
  message?: string;
}

export interface QueuedAction {
  message: NotificationMessage;
  order: number;
}

export interface ValidationResult {
  label: string;
  valid: boolean;
  error?: string;
  params?: Record<string, string | number>;
}

export interface ScenarioInfo {
  name: string;
  active: boolean;
  setting?: ScenarioSetting;
  validation: ValidationResult[];
  error?: string;
}

export interface ProductInfo {
  SERVER_VERSION?: string;
  SERVER_DESC?: string;
  CLIENT_VERSION?: string;
  CLIENT_DESC?: string;
  COPYRIGHT?: string;
  CAPTION?: string;
}

/** WebSocket でサーバから送られるメッセージ */
export type ServerPush =
  | { type: "event"; event: NotificationMessage }
  | { type: "presence"; team: string; when: number; members: MemberWithPresence[] }
  | { type: "alert"; message: string };

/** 参加者向けヘルプ「役割とアクション」 */
export interface HelpInfo {
  actions: Array<{ id: string; name: string; description: string; holders: string[] }>;
  roles: Array<{ role: string; rolename: string; desc: string; system: boolean }>;
}

export interface ApiError {
  status: number;
  message: string;
}
