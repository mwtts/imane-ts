import type { NotificationMessage, WorkflowState, WorkflowSummary } from "@imane/shared";

const pad = (n: number) => String(n).padStart(2, "0");

/** MM/DD HH:mm:ss */
export function formatDate(ms: number | undefined): string {
  if (!ms || ms <= 0) return "N/A";
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** [HH:]MM:SS */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [...(h ? [pad(h)] : []), pad(m), pad(s % 60)].join(":");
}

export const STATE_LABELS: Record<WorkflowState, string> = {
  None: "未開始",
  Started: "実行中",
  Ended: "終了",
  Suspended: "一時停止",
  Aborted: "中断",
};

export const scenarioLabel = (name: string) => (name === "_default_" ? "既定" : name);

/** 「チーム: シナリオ フェーズ (状態) 開始 制限時間 経過 残り スコア」の1行 */
export function workflowStatusLine(wf: WorkflowSummary, now: number): string {
  const head = `${wf.team}: シナリオ[${scenarioLabel(wf.scenario)}]`;
  if (wf.phase <= 0) return `${head} (状態:${STATE_LABELS[wf.state]})`;
  const elapsed = wf.start ? (now - wf.start) / 1000 : 0;
  const parts = [`${head} フェーズ${wf.phase} (状態:${STATE_LABELS[wf.state]})`, `開始:${formatDate(wf.start)}`];
  if (wf.timelimit) {
    const rest = wf.timelimit - elapsed;
    parts.push(`制限時間:${formatSeconds(wf.timelimit)}`);
    parts.push(`経過:${formatSeconds(elapsed)}`);
    parts.push(rest >= 0 ? `残り:${formatSeconds(rest)}` : `超過:${formatSeconds(-rest)}`);
  } else {
    parts.push(`経過:${formatSeconds(elapsed)}`);
  }
  parts.push(`スコア:${wf.score}`);
  return parts.join(" ");
}

const MAX_MESSAGE_LEN = 80;

/** イベントに表示する日時(返信は返信日時) */
export const eventTime = (m: NotificationMessage) => m.replyDate ?? m.sentDate;

/** 一覧に表示する短いメッセージ */
export function compressMessage(m: NotificationMessage): string {
  const msg = m.reply ? `${m.reply.name ?? ""}:${m.reply.message ?? ""}` : m.message || m.action.message || "";
  return msg.length > MAX_MESSAGE_LEN + 3 ? `${msg.slice(0, MAX_MESSAGE_LEN)}...` : msg;
}

/** 返信元などに使う1行の要約 */
export function summarizeMessage(m: NotificationMessage): string {
  return `${formatDate(m.sentDate)}: [${m.action.name}] ${m.from.rolename}から${m.to.rolename}: ${compressMessage(m)}`;
}

/** 詳細表示用のメッセージ */
export function fullMessage(m: NotificationMessage): string {
  if (m.reply) return `${m.reply.name ?? ""}\n${m.reply.message ?? ""}`;
  return m.message || m.action.message || "";
}

/** イベントに添付されたステートカードID */
export function eventStateIds(m: NotificationMessage): string[] {
  const ids = new Set([...(m.action.attachments ?? []), ...(m.action.statecards ?? [])]);
  if (m.reply?.state) ids.add(m.reply.state);
  return [...ids];
}

/** 演習中に表示しないイベント(空応答・非表示応答) */
export function isHiddenEvent(m: NotificationMessage): boolean {
  return m.reply?.type === "null" || m.reply?.type === "hidden";
}

/** 返信時に本文へ引用する文字列 */
export function quoteForReply(m: NotificationMessage): string {
  return [
    "",
    ">返信元イベント:",
    ">",
    `>日時:${formatDate(m.sentDate)}`,
    `>From:${m.from.name}`,
    `>To:${m.to.name}`,
    `>アクション:${m.action.name}`,
    `>${m.message || m.action.message || ""}`,
  ].join("\n");
}
