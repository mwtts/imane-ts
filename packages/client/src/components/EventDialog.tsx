import type { NotificationMessage, PointCard, PublicMember, StateData } from "@imane/shared";
import { eventStateIds, formatDate, fullMessage, summarizeMessage } from "../format";
import { Modal, StateChips } from "./ui";

const who = (m: PublicMember) => (m.email ? `${m.rolename} <${m.email}>` : m.rolename);

export function EventDialog(props: {
  event: NotificationMessage;
  points?: PointCard[];
  onClose: () => void;
  onReply?: (e: NotificationMessage) => void;
  onPlay?: (s: StateData) => void;
}) {
  const e = props.event;
  return (
    <Modal
      title="イベント"
      onClose={props.onClose}
      size="wide"
      footer={
        <>
          {props.onReply && (
            <button type="button" onClick={() => props.onReply?.(e)}>
              <span className="fa fa-mail-reply" /> 返信/転送
            </button>
          )}
          <button type="button" onClick={props.onClose}>
            閉じる
          </button>
        </>
      }
    >
      <table className="form-table">
        <tbody>
          <tr>
            <th>発生日時</th>
            <td>
              {formatDate(e.sentDate)}
              {e.replyDate && e.replyDate !== e.sentDate && (
                <span className="muted">（応答 {formatDate(e.replyDate)}）</span>
              )}
            </td>
          </tr>
          <tr>
            <th>アクション</th>
            <td>
              <span title={e.action.description}>{e.action.name}</span>
              {e.action.description && <div className="muted">{e.action.description}</div>}
            </td>
          </tr>
          <tr>
            <th>From</th>
            <td>{who(e.from)}</td>
          </tr>
          <tr>
            <th>To</th>
            <td>{who(e.to)}</td>
          </tr>
          <tr>
            <th>Cc</th>
            <td>{(e.cc ?? []).map(who).join("; ")}</td>
          </tr>
          <tr>
            <th>インシデント情報</th>
            <td>
              <StateChips ids={eventStateIds(e)} onPlay={props.onPlay} />
              {(props.points ?? []).map((p, i) => (
                <span key={i} className="chip chip-point" title={p.description}>
                  {p.name || p.id}: {p.point ?? 0}点
                </span>
              ))}
            </td>
          </tr>
          {e.replyTo && (
            <tr>
              <th>返信元</th>
              <td className="muted">{summarizeMessage(e.replyTo)}</td>
            </tr>
          )}
          <tr>
            <th>メッセージ</th>
            <td>
              <textarea readOnly rows={10} value={fullMessage(e)} />
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
