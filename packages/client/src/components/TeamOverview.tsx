import type { ReactNode } from "react";
import type {
  AvailableCard,
  MemberWithPresence,
  PointCard,
  QueuedAction,
  ReplyData,
  StateData,
  WorkflowSummary,
} from "@imane/shared";
import { formatDate } from "../format";
import { ConditionChips, Empty, StateChip, StateChips } from "./ui";

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="section">
      <summary>
        {title} <span className="muted">({count})</span>
      </summary>
      {count === 0 ? <Empty /> : <div className="table-scroll">{children}</div>}
    </details>
  );
}

const systemPhases = (m: MemberWithPresence) =>
  (m.system ?? []).map((v, i) => (v ? i + 1 : 0)).filter((p) => p > 0);

export interface TeamOverviewProps {
  workflow: WorkflowSummary;
  members: MemberWithPresence[];
  actions: AvailableCard[];
  states: StateData[];
  replies: ReplyData[];
  points: PointCard[];
  onInject: (role: string) => void;
}

export function TeamOverview(p: TeamOverviewProps) {
  return (
    <div className="overview">
      <Section title="メンバ" count={p.members.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th />
              <th>ロール</th>
              <th>ID</th>
              <th>説明</th>
              <th>所有ステート</th>
              <th>自動応答フェーズ</th>
            </tr>
          </thead>
          <tbody>
            {p.members.map((m) => {
              const phases = systemPhases(m);
              const system = phases.includes(p.workflow.phase) || (p.workflow.phase === 0 && phases.includes(1));
              return (
                <tr key={m.email} className={system ? "member-system" : ""}>
                  <td className="nowrap">
                    <span className={`fa ${m.online ? "fa-wifi online" : "fa-times-circle offline"}`} title={m.online ? "オンライン" : "オフライン"} />{" "}
                    <span className={`fa ${system ? "fa-user-o" : "fa-user"}`} title={system ? "自動応答ユーザ" : "参加者"} />
                  </td>
                  <td>
                    <button type="button" className="link" title="このロールに通知を送ります。" onClick={() => p.onInject(m.role)}>
                      {m.icon && <span className={`fa ${m.icon}`} />} {m.rolename}({m.role})
                    </button>
                  </td>
                  <td>{m.email}</td>
                  <td className="pre">{m.desc}</td>
                  <td>
                    <StateChips ids={m.availableStates} />
                  </td>
                  <td>{phases.join(",")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="アクション" count={p.actions.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>名前</th>
              <th>説明/メッセージ</th>
              <th>種類</th>
              <th title="自動アクションが実行された日時">発生日時</th>
              <th title="このアクションを使用できるロールと自動アクションの送信元/宛先">ロール</th>
              <th title="アクションにより添付・追加・削除されるステートカード">ステート</th>
              <th title="アクションの実行条件">ステート条件</th>
              <th title="アクションを使用できるフェーズ">フェーズ</th>
            </tr>
          </thead>
          <tbody>
            {p.actions.map((a) => (
              <tr key={a.id} className={a.available ? "" : "unavailable"}>
                <td>{a.id}</td>
                <td title={a.description}>
                  {a.icon && <span className={`fa ${a.icon}`} />} {a.name}
                </td>
                <td>
                  {a.description}
                  {a.message && `「${a.message}」`}
                </td>
                <td>{a.type}</td>
                <td>{p.workflow.autoActionHistory[a.id] ? formatDate(p.workflow.autoActionHistory[a.id]) : ""}</td>
                <td>
                  {(a.roles ?? []).join(",")} {a.from && `${a.from}から`}
                  {a.to && `${a.to}宛`}
                </td>
                <td>
                  <StateChips ids={a.attachments} />
                  <StateChips ids={a.addstate} kind="add" />
                  <StateChips ids={a.removestate} kind="remove" />
                </td>
                <td>
                  <ConditionChips cond={a.systemstatecondition} />
                  <ConditionChips cond={a.statecondition} />
                </td>
                <td>{(a.phase ?? []).join(",")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="ステート" count={p.states.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>名前</th>
              <th>説明</th>
              <th title="システムステートに登録された日時">システムステート</th>
            </tr>
          </thead>
          <tbody>
            {p.states.map((s) => (
              <tr key={s.id} className={s.when ? "state-active" : ""}>
                <td>{s.id}</td>
                <td>
                  {s.icon && <span className={`fa ${s.icon}`} />} {s.name}
                </td>
                <td>{s.description}</td>
                <td>{s.when ? formatDate(s.when) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="リプライ" count={p.replies.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th title="リプライの対象となるアクションのID">アクションID</th>
              <th>名前/メッセージ</th>
              <th>ロール</th>
              <th title="添付するステートカード、追加・削除するシステムステート">ステート</th>
              <th title="このリプライが適用されるためのシステムステート条件">ステート条件</th>
              <th>オーダー</th>
              <th>待ち時間</th>
            </tr>
          </thead>
          <tbody>
            {p.replies.map((r, i) => (
              <tr key={i}>
                <td>{r.actionid}</td>
                <td>
                  {r.name} {r.message && `「${r.message}」`}
                  {r.type && <span className="muted"> ({r.type})</span>}
                </td>
                <td>
                  {r.from && `${r.from}から`}
                  {r.to}
                </td>
                <td>
                  {r.state && <StateChip id={r.state} />}
                  <StateChips ids={r.addstate} kind="add" />
                  <StateChips ids={r.removestate} kind="remove" />
                </td>
                <td>
                  <ConditionChips cond={r.statecondition} />
                </td>
                <td>{r.order ?? 0}</td>
                <td>{r.delay ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="ポイント" count={p.points.length}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>名前/説明</th>
              <th>得点</th>
              <th>システムステート</th>
              <th>前提条件</th>
              <th>フェーズ</th>
              <th>経過時間条件(秒)</th>
            </tr>
          </thead>
          <tbody>
            {p.points.map((pt) => (
              <tr key={pt.id}>
                <td>{pt.id}</td>
                <td>
                  {pt.name} {pt.description}
                </td>
                <td>{pt.point}</td>
                <td>{pt.state && <StateChip id={pt.state} />}</td>
                <td>
                  <ConditionChips cond={pt.statecondition} />
                </td>
                <td>{(pt.phase ?? -1) <= 0 ? "すべて" : pt.phase}</td>
                <td>
                  {pt.after || ""}〜{pt.before || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

export function QueueTable({ queue }: { queue: QueuedAction[] }) {
  if (queue.length === 0) return <Empty>キューに待機中のアクションはありません。</Empty>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>日時</th>
            <th>アクション</th>
            <th>メッセージ</th>
            <th>From</th>
            <th>To</th>
            <th>オーダー</th>
            <th>情報</th>
          </tr>
        </thead>
        <tbody>
          {queue.map(({ message: m, order }) => (
            <tr key={m.id}>
              <td className="nowrap">{formatDate(m.sentDate)}</td>
              <td>{m.action.name}</td>
              <td>{m.message}</td>
              <td>{m.from.rolename}</td>
              <td>{m.to.rolename}</td>
              <td>{order}</td>
              <td>
                <StateChips ids={m.action.attachments} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TriggerTable({ triggers, start }: { triggers: ReplyData[]; start?: number }) {
  if (triggers.length === 0) return <Empty>このフェーズにトリガーイベントはありません。</Empty>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>発火日時</th>
            <th>経過時間(秒)</th>
            <th>ステート</th>
            <th>ステート条件</th>
            <th>メッセージ</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((t, i) => (
            <tr key={i} className={t.fireWhen ? "fired" : ""}>
              <td className="nowrap">{t.fireWhen ? formatDate(t.fireWhen) : "未発火"}</td>
              <td>
                {t.elapsed}
                {start && (t.elapsed ?? -1) >= 0 && <span className="muted"> (予定:{formatDate(start + (t.elapsed ?? 0) * 1000)})</span>}
              </td>
              <td>{t.state && <StateChip id={t.state} />}</td>
              <td>
                <ConditionChips cond={t.statecondition} />
              </td>
              <td>
                {t.name} {t.message}
              </td>
              <td>{t.from ?? "system"}</td>
              <td>{t.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
