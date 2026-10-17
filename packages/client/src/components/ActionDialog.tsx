import { useMemo, useState } from "react";
import { isSystemUser, ROLE_TEAM, type AvailableCard, type MemberWithPresence, type NotificationMessage } from "@imane/shared";
import { api } from "../api";
import { errorText, useApp } from "../context";
import { compressMessage, formatDate, quoteForReply } from "../format";
import { Modal } from "./ui";

export type ActionMode = "new" | "reply" | "injection";

export interface ActionDialogProps {
  mode: ActionMode;
  cards: AvailableCard[];
  members: MemberWithPresence[];
  events: NotificationMessage[];
  ownedStates: string[];
  phase: number;
  /** アクションIDごとの送信回数(選択肢の色分けに使う) */
  sentCount?: Record<string, number>;
  replySource?: NotificationMessage;
  presetTo?: string;
  onClose: () => void;
  onSent?: () => void;
}

/** ステートカードを添付できるアクションか */
function canAttach(card: AvailableCard | undefined): boolean {
  if (!card) return false;
  if (card.type === "talk") return false;
  if (card.type === "action") return card.attach === true;
  return true;
}

function initialTo(props: ActionDialogProps, members: MemberWithPresence[]): string {
  if (props.presetTo) return props.presetTo;
  const role = props.replySource?.from.role;
  return role && members.some((m) => m.role === role) ? role : "";
}

export function ActionDialog(props: ActionDialogProps) {
  const { session, states, stateById, notify } = useApp();
  const injection = props.mode === "injection";
  const me = props.members.find((m) => m.email === session?.userid);

  /** 宛先候補: 参加者は recipients の順。インジェクションはチーム全員 */
  const recipients = useMemo(() => {
    const visible = props.members.filter((m) => !m.hidden);
    if (injection || !me?.recipients?.length) return visible;
    return me.recipients.map((r) => visible.find((m) => m.role === r)).filter((m) => m !== undefined);
  }, [props.members, injection, me]);

  const selectableCards = useMemo(
    () => props.cards.filter((c) => injection || (c.available && !c.hidden && c.type !== "auto")),
    [props.cards, injection],
  );

  const [actionId, setActionId] = useState("");
  const [to, setTo] = useState(() => initialTo(props, recipients));
  const [cc, setCc] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState(props.replySource?.id ?? "");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [message, setMessage] = useState(props.replySource ? quoteForReply(props.replySource) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const card = selectableCards.find((c) => c.id === actionId);
  const attachEnabled = injection || canAttach(card);
  const stateOptions = useMemo(() => {
    if (injection) return states.map((s) => s.id);
    return [...new Set([...props.ownedStates, ...(card?.attachments ?? [])])];
  }, [injection, states, props.ownedStates, card]);

  const changeAction = (id: string) => {
    setActionId(id);
    const next = selectableCards.find((c) => c.id === id);
    setAttachments(next?.attachments ?? []);
    if (next?.message && message.trim() === "") setMessage(next.message);
  };

  const online = (m: MemberWithPresence) => isSystemUser(m, props.phase) || m.online;

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!card) e.action = "アクションを選択してください。";
    if (!to) e.to = "[To]を選択してください。";
    if (card?.type === "talk" && message.trim() === "") e.message = "「話し合い」を行うには、メッセージを入力してください。";
    if ((card?.type === "share" || card?.id === "i0009") && attachments.length === 0) {
      e.state = "「インシデント情報共有」を行うには、共有したいインシデント情報を選択してください。";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!card || !validate()) return;
    setSending(true);
    try {
      await api.act({
        actionId: card.id,
        to,
        cc: cc.length > 0 ? cc : undefined,
        replyTo: replyTo || undefined,
        attachments: attachEnabled ? attachments : undefined,
        message,
      });
      props.onSent?.();
      props.onClose();
    } catch (err) {
      notify(errorText(err), "error");
    } finally {
      setSending(false);
    }
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const countClass = (id: string) => {
    const n = props.sentCount?.[id] ?? 0;
    return n === 0 ? "count-none" : n === 1 ? "count-once" : "count-many";
  };

  return (
    <Modal
      title={injection ? "インジェクション" : "アクション"}
      onClose={props.onClose}
      size="wide"
      footer={
        <>
          <button type="button" className="primary" onClick={submit} disabled={sending}>
            <span className="fa fa-paper-plane" /> 実行
          </button>
          <button type="button" onClick={props.onClose}>
            キャンセル
          </button>
        </>
      }
    >
      <table className="form-table">
        <tbody>
          <tr>
            <th title="実行するアクションを選択します。">アクション</th>
            <td>
              <select value={actionId} onChange={(e) => changeAction(e.target.value)} aria-invalid={!!errors.action}>
                <option value="">選択してください。</option>
                {selectableCards.map((c) => (
                  <option key={c.id} value={c.id} title={c.description} className={countClass(c.id)}>
                    {c.name}
                    {(props.sentCount?.[c.id] ?? 0) > 0 ? ` (${props.sentCount?.[c.id]}回実行済)` : ""}
                  </option>
                ))}
              </select>
              {card?.description && <div className="muted">{card.description}</div>}
              {errors.action && <div className="input-error">{errors.action}</div>}
            </td>
          </tr>
          <tr>
            <th title="アクションの対象を選択します。">To</th>
            <td>
              <select value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!errors.to}>
                <option value="">選択してください。</option>
                {injection && <option value={ROLE_TEAM}>チーム全員</option>}
                {recipients.map((m) => {
                  const unacceptable = card?.recipients?.length && !card.recipients.includes(m.role);
                  return (
                    <option key={m.role} value={m.role} disabled={!online(m)} title={m.desc}>
                      {m.rolename}
                      {online(m) ? "" : "(オフライン)"}
                      {unacceptable ? "（対象外）" : ""}
                    </option>
                  );
                })}
              </select>
              {errors.to && <div className="input-error">{errors.to}</div>}
            </td>
          </tr>
          <tr>
            <th title="情報共有のため、アクションの実行イベントを同報で通知します。">Cc</th>
            <td className="checkbox-list">
              {recipients
                .filter((m) => m.role !== to)
                .map((m) => (
                  <label key={m.role} className={online(m) ? "" : "disabled"}>
                    <input
                      type="checkbox"
                      checked={cc.includes(m.role)}
                      disabled={!online(m)}
                      onChange={() => setCc((l) => toggle(l, m.role))}
                    />
                    {m.rolename}
                  </label>
                ))}
            </td>
          </tr>
          <tr>
            <th title="受信したイベントに対して返信します。">返信元</th>
            <td>
              <select value={replyTo} onChange={(e) => setReplyTo(e.target.value)}>
                <option value="">なし</option>
                {props.events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {formatDate(ev.sentDate)}: {ev.from.rolename} &gt; {ev.to.rolename} [{ev.action.name}] {compressMessage(ev)}
                  </option>
                ))}
              </select>
            </td>
          </tr>
          <tr>
            <th title="所有しているインシデント情報を共有します。">インシデント情報</th>
            <td className={`checkbox-list ${attachEnabled ? "" : "disabled"}`}>
              {stateOptions.length === 0 && <span className="muted">共有できるインシデント情報はありません。</span>}
              {stateOptions.map((id) => {
                const s = stateById(id);
                return (
                  <label key={id} title={s?.description}>
                    <input
                      type="checkbox"
                      checked={attachments.includes(id)}
                      disabled={!attachEnabled}
                      onChange={() => setAttachments((l) => toggle(l, id))}
                    />
                    {s?.name ?? id}
                  </label>
                );
              })}
              {errors.state && <div className="input-error">{errors.state}</div>}
            </td>
          </tr>
          <tr>
            <th title="任意のメッセージを追加します。">メッセージ</th>
            <td>
              <textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={!!errors.message} />
              {errors.message && <div className="input-error">{errors.message}</div>}
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
