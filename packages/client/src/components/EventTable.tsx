import type { NotificationMessage, PointCard, StateData } from "@imane/shared";
import { useCallback, useMemo, useState } from "react";
import { compressMessage, eventStateIds, eventTime, formatDate, isHiddenEvent, summarizeMessage } from "../format";
import { Empty, StateChips } from "./ui";

const MARK_KEY = "imane.marks";

function loadMarks(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(MARK_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

/** イベントのマーク(ブラウザごとに保存) */
export function useMarks(): [Set<string>, (id: string) => void] {
  const [marks, setMarks] = useState(loadMarks);
  const toggle = useCallback((id: string) => {
    setMarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(MARK_KEY, JSON.stringify([...next]));
      } catch {
        // 保存できなくても表示上は切り替える
      }
      return next;
    });
  }, []);
  return [marks, toggle];
}

type SortKey = "date" | "from" | "to" | "action";

const sortValue: Record<SortKey, (m: NotificationMessage) => string | number> = {
  date: eventTime,
  from: (m) => m.from.rolename,
  to: (m) => m.to.rolename,
  action: (m) => m.action.name,
};

export interface EventTableProps {
  events: readonly NotificationMessage[];
  /** 自分のメールアドレス(送信/受信の区別に使う) */
  selfEmail?: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onPlay?: (s: StateData) => void;
  pointchest?: Record<string, PointCard[]>;
}

export function EventTable(props: EventTableProps) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "date", desc: true });
  const [marks, toggleMark] = useMarks();

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const visible = props.events.filter((m) => {
      if (seen.has(m.id) || isHiddenEvent(m) || m.action.type === "alert") return false;
      seen.add(m.id);
      return true;
    });
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? visible.filter((m) =>
          [m.from.rolename, m.to.rolename, m.action.name, compressMessage(m), ...(m.cc ?? []).map((c) => c.rolename)]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : visible;
    const key = sortValue[sort.key];
    return [...filtered].sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "ja");
      return sort.desc ? -c : c;
    });
  }, [props.events, filter, sort]);

  const header = (key: SortKey, label: string, title: string) => (
    <th
      title={title}
      className="sortable"
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === "date" }))}
    >
      {label}
      {sort.key === key && <span className={`fa fa-sort-${sort.desc ? "desc" : "asc"}`} />}
    </th>
  );

  return (
    <div className="event-table">
      <div className="table-tools">
        <input
          type="search"
          className="searchbox"
          placeholder="絞り込み"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="イベントを絞り込む"
        />
        <span className="muted">{rows.length}件</span>
      </div>
      {rows.length === 0 ? (
        <Empty>イベントはまだありません。</Empty>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th aria-label="種別" />
                {header("date", "日時", "イベントが発生した日時")}
                {header("from", "From", "イベントの送信元")}
                {header("to", "To/Cc", "イベントの宛先")}
                {header("action", "アクション", "イベントの発生元となったアクション")}
                <th title="イベントに添付されたインシデント情報">インシデント情報</th>
                <th title="イベントに添付されたフリーテキスト">メッセージ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const sent = props.selfEmail !== undefined && m.from.email === props.selfEmail;
                const marked = marks.has(m.id);
                return (
                  <tr
                    key={m.id}
                    className={[props.selectedId === m.id ? "selected" : "", marked ? "marked" : ""].join(" ")}
                    onClick={() => props.onSelect(m.id)}
                    onDoubleClick={() => props.onOpen(m.id)}
                    title={`日時:${formatDate(eventTime(m))}\nFrom:${m.from.rolename}\nTo:${m.to.rolename}\n\n${m.action.name}:${compressMessage(m)}`}
                  >
                    <td className="nowrap">
                      {props.selfEmail !== undefined && (
                        <span
                          className={`fa ${sent ? "fa-level-up sent" : "fa-level-down received"}`}
                          title={sent ? "送信" : "受信"}
                        />
                      )}
                      <button
                        type="button"
                        className={`icon-button mark ${marked ? "on" : ""}`}
                        title="マーク設定/解除"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMark(m.id);
                        }}
                      >
                        <span className={`fa ${marked ? "fa-bookmark" : "fa-bookmark-o"}`} />
                      </button>
                    </td>
                    <td className="nowrap">{formatDate(eventTime(m))}</td>
                    <td>{m.from.rolename}</td>
                    <td>
                      {m.to.rolename}
                      {m.cc && m.cc.length > 0 && (
                        <span className="muted">; {m.cc.map((c) => c.rolename).join("; ")}</span>
                      )}
                    </td>
                    <td>
                      {m.action.icon && <span className={`fa ${m.action.icon}`} />} {m.action.name}
                    </td>
                    <td>
                      <StateChips ids={eventStateIds(m)} onPlay={props.onPlay} />
                      {(props.pointchest?.[m.id] ?? []).map((p, i) => (
                        <span key={i} className="chip chip-point" title={p.description}>
                          {p.name || p.id}: {p.point ?? 0}点
                        </span>
                      ))}
                    </td>
                    <td className="message-cell">
                      {compressMessage(m)}
                      {m.replyTo && (
                        <div className="reply-source" title={summarizeMessage(m.replyTo)}>
                          返信元: {summarizeMessage(m.replyTo)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
