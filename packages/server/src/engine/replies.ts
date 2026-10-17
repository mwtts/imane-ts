import { isSystemUser, memberMatchesRole, type PublicMember, type ReplyData } from "@imane/shared";
import type { Scenario } from "../scenario/loader";

export const REPLY_TYPE = {
  NOT_FOUND: "notfound",
  NULL: "null",
  HIDDEN: "hidden",
  TRIGGER: "trigger",
} as const;

/** 互換性のため actionid "s0000" もトリガーイベントとして扱う */
const LEGACY_TRIGGER_ACTION = "s0000";

const FALLBACK_NOT_FOUND: ReplyData = {
  actionid: "all",
  to: "all",
  name: "こちらの対応範囲外です。別のところにお問い合わせ下さい。",
  type: REPLY_TYPE.NOT_FOUND,
  delay: 5,
  abort: true,
};

const FALLBACK_NULL: ReplyData = {
  actionid: "all",
  to: "all",
  name: "空の応答",
  type: REPLY_TYPE.NULL,
  delay: 0,
  abort: true,
};

export function isTriggerReply(r: ReplyData): boolean {
  return r.type === REPLY_TYPE.TRIGGER || r.actionid === LEGACY_TRIGGER_ACTION;
}

export function repliesForPhase(scenario: Scenario, phase: number): readonly ReplyData[] {
  return scenario.replies.get(phase) ?? [];
}

function replyByType(scenario: Scenario, phase: number, type: string, fallback: ReplyData): ReplyData {
  const found = repliesForPhase(scenario, phase).find((r) => r.type === type);
  return structuredClone(found ?? fallback);
}

/** 該当するリプライがない場合のエラー応答 */
export function errorReply(scenario: Scenario, phase: number): ReplyData {
  return replyByType(scenario, phase, REPLY_TYPE.NOT_FOUND, FALLBACK_NOT_FOUND);
}

/** 自動応答ユーザでない宛先への空応答(画面には表示されない) */
export function nullReply(scenario: Scenario, phase: number): ReplyData {
  return replyByType(scenario, phase, REPLY_TYPE.NULL, FALLBACK_NULL);
}

/**
 * 宛先(to)・送信元(from)がリプライの条件に合うか。
 * 宛先は自動応答ユーザでなければならない。
 */
export function checkRecipients(
  r: ReplyData,
  to: PublicMember | undefined,
  from: PublicMember | undefined,
  phase: number,
): boolean {
  if (to && !isSystemUser(to, phase)) return false;
  if (to && !memberMatchesRole(to, r.to)) return false;
  if (from && !memberMatchesRole(from, r.from)) return false;
  return true;
}

/** attachmentcondition が指定されていれば、そのステートが添付されている場合だけ適用する */
export function checkAttachmentCondition(r: ReplyData, attachments: readonly string[] | undefined): boolean {
  if (!r.attachmentcondition) return true;
  return (attachments ?? []).includes(r.attachmentcondition);
}

export interface ReplyQuery {
  phase: number;
  actionId: string | undefined;
  to: PublicMember;
  from?: PublicMember;
  /** 0 ならすべてのオーダーが候補 */
  order: number;
  attachments: readonly string[] | undefined;
}

/**
 * アクションに対するリプライの候補を返す。
 * 候補がなく宛先が自動応答ユーザの場合はエラー応答を1件返す。
 */
export function findReplies(scenario: Scenario, q: ReplyQuery): ReplyData[] {
  const ret: ReplyData[] = [];
  for (const r of repliesForPhase(scenario, q.phase)) {
    if (q.actionId !== undefined && r.actionid !== undefined && r.actionid !== q.actionId) continue;
    if (r.type === REPLY_TYPE.NOT_FOUND || r.type === REPLY_TYPE.TRIGGER) continue;
    if (q.order !== 0 && (r.order ?? 0) !== q.order) continue;
    if (!checkAttachmentCondition(r, q.attachments)) continue;
    if (!checkRecipients(r, q.to, q.from, q.phase)) continue;
    ret.push(r);
  }
  if (ret.length === 0 && isSystemUser(q.to, q.phase)) ret.push(errorReply(scenario, q.phase));
  return ret;
}
