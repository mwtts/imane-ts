import { isBroadcastRole, ROLE_SYSTEM, type NotificationMessage, type PublicMember } from "@imane/shared";
import { compressMessage, eventStateIds, eventTime, formatDate, isHiddenEvent, summarizeMessage } from "./format";

export interface SequenceOptions {
  /** 表示するロール(未指定ならすべて) */
  visibleRoles?: ReadonlySet<string>;
  /** やりとりのないロールを隠す */
  hideInactive: boolean;
  /** 「話し合い」(talk)を隠す */
  hideTalk: boolean;
  /** 日時とアクション名だけを表示する */
  compact: boolean;
  /** setting.json の roles-order */
  rolesOrder?: Array<{ role: string; order: number }>;
  stateName: (id: string) => string;
  pointNames?: (eventId: string) => string[];
}

/** mermaid の構文として解釈される文字を全角に置き換える */
export function sanitize(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/;/g, "；")
    .replace(/#/g, "＃")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")
    .replace(/%%/g, "％％")
    .trim();
}

function orderedMembers(members: readonly PublicMember[], rolesOrder?: SequenceOptions["rolesOrder"]): PublicMember[] {
  if (!rolesOrder || rolesOrder.length === 0) return [...members];
  return [...rolesOrder]
    .sort((a, b) => a.order - b.order)
    .map((r) => members.find((m) => m.role === r.role))
    .filter((m) => m !== undefined);
}

function isDrawable(m: NotificationMessage, opts: SequenceOptions): boolean {
  if (isHiddenEvent(m) || m.action.type === "alert") return false;
  return !(opts.hideTalk && m.action.type === "talk");
}

function eventText(m: NotificationMessage, opts: SequenceOptions): string {
  const head = `${formatDate(eventTime(m))} [${m.action.name}]`;
  if (opts.compact) return sanitize(head);
  const states = eventStateIds(m).map((id) => `[${opts.stateName(id)}]`);
  const points = (opts.pointNames?.(m.id) ?? []).map((p) => `★${p}`);
  const body = [compressMessage(m), m.replyTo ? `(返信元:${summarizeMessage(m.replyTo)})` : ""].filter(Boolean).join(" ");
  const tail = [...states, ...points].join(" ");
  return [sanitize(`${head} ${body}`), tail ? sanitize(tail) : ""].filter(Boolean).join("<br/>");
}

/** イベント履歴から mermaid のシーケンス図を作る */
export function buildSequence(events: readonly NotificationMessage[], members: readonly PublicMember[], opts: SequenceOptions): string {
  const drawable = events.filter((m) => isDrawable(m, opts));
  const active = new Set<string>();
  for (const m of drawable) {
    active.add(m.from.role);
    active.add(m.to.role);
    for (const c of m.cc ?? []) active.add(c.role);
  }

  const participants = orderedMembers(members, opts.rolesOrder).filter(
    (m) => (opts.visibleRoles?.has(m.role) ?? true) && (!opts.hideInactive || active.has(m.role)),
  );
  const alias = new Map<string, string>([[ROLE_SYSTEM, "p0"]]);
  participants.forEach((m, i) => alias.set(m.role, `p${i + 1}`));
  const first = "p0";
  const last = participants.length > 0 ? `p${participants.length}` : "p0";

  const lines = ["sequenceDiagram", "participant p0 as システム", ...participants.map((m, i) => `participant p${i + 1} as ${sanitize(m.rolename)}`)];
  for (const m of drawable) {
    const from = alias.get(m.from.role);
    const text = eventText(m, opts);
    if (isBroadcastRole(m.to.role)) {
      if (from !== undefined) lines.push(`Note over ${first},${last}: ${text}`);
      continue;
    }
    const to = alias.get(m.to.role);
    if (from === undefined || to === undefined) continue;
    lines.push(`${from}->>${to}: ${text}`);
    for (const c of m.cc ?? []) {
      const cc = alias.get(c.role);
      if (cc !== undefined) lines.push(`${from}-->>${cc}: ${text}`);
    }
  }
  return lines.join("\n");
}
