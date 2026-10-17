import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AvailableCard,
  MemberWithPresence,
  NotificationMessage,
  PhaseData,
  PointCard,
  ProcessSummary,
  QueuedAction,
  ReplyData,
  StateData,
} from "@imane/shared";
import { api } from "../api";
import { ActionDialog } from "../components/ActionDialog";
import { EventDialog } from "../components/EventDialog";
import { EventTable } from "../components/EventTable";
import { ScenarioBar } from "../components/ScenarioBar";
import { QueueTable, TeamOverview, TriggerTable } from "../components/TeamOverview";
import { Empty, Tabs } from "../components/ui";
import { errorText, useApp } from "../context";
import { formatDate, formatSeconds, scenarioLabel, STATE_LABELS, workflowStatusLine } from "../format";
import { useInterval, usePush } from "../push";

interface TeamDetail {
  members: MemberWithPresence[];
  actions: AvailableCard[];
  states: StateData[];
  replies: ReplyData[];
  points: PointCard[];
  history: NotificationMessage[];
  queue: QueuedAction[];
  triggers: ReplyData[];
}

async function loadDetail(team: string, phase: number): Promise<TeamDetail> {
  const [members, actions, states, replies, points, history, queue, triggers] = await Promise.all([
    api.members(team),
    api.allActions(),
    api.systemStates(team),
    api.replies(phase),
    api.points(phase),
    api.history(team),
    api.queue(team),
    api.triggers(team),
  ]);
  return { members, actions, states, replies, points, history, queue, triggers };
}

function PhasePicker(props: { phases: PhaseData[]; value?: number; onChange: (p: number) => void; name: string }) {
  return (
    <span className="phase-picker" role="radiogroup" aria-label="フェーズ">
      {props.phases.map((p) => (
        <label key={p.phase} title={p.description}>
          <input type="radio" name={props.name} checked={props.value === p.phase} onChange={() => props.onChange(p.phase)} />
          {p.phase}
        </label>
      ))}
    </span>
  );
}

export function FacilitatorView() {
  const { session, notify } = useApp();
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [phases, setPhases] = useState<PhaseData[]>([]);
  const [selected, setSelected] = useState<string>();
  const [phaseChoice, setPhaseChoice] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [autoProcesses, setAutoProcesses] = useState(false);
  const [autoDetail, setAutoDetail] = useState(false);
  const [inject, setInject] = useState<{ to?: string } | null>(null);
  const [openId, setOpenId] = useState<string>();
  const [selectedEvent, setSelectedEvent] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const restoreRef = useRef<HTMLInputElement>(null);

  const refreshProcesses = useCallback(async () => {
    try {
      const [procs, scenarios] = await Promise.all([api.processes(), api.scenarios()]);
      setProcesses(procs);
      const active = scenarios.find((s) => s.active);
      const ph = active?.setting?.phases ?? [];
      setPhases(ph);
      setPhaseChoice((prev) => {
        const next = { ...prev };
        for (const p of procs) next[p.team] ??= p.workflow.phase > 0 ? p.workflow.phase : ph.length === 1 ? ph[0]!.phase : 0;
        next.all ??= ph.length === 1 ? ph[0]!.phase : 0;
        return next;
      });
      setSelected((cur) => cur ?? (procs.length === 1 ? procs[0]!.team : undefined));
    } catch (e) {
      notify(errorText(e), "error");
    }
  }, [notify]);

  const selectedProc = processes.find((p) => p.team === selected);

  const refreshDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const phase = processes.find((p) => p.team === selected)?.workflow.phase ?? 0;
      setDetail(await loadDetail(selected, phase > 0 ? phase : -1));
    } catch (e) {
      notify(errorText(e), "error");
    }
  }, [selected, processes, notify]);

  useEffect(() => {
    void refreshProcesses();
  }, [refreshProcesses]);
  // processes の更新ごとに読み直すと重いので、チームの選択時だけ読む
  useEffect(() => {
    void refreshDetail();
  }, [selected]);

  useInterval(() => setNow(Date.now()), 1000);
  useInterval(() => void refreshProcesses(), 20_000, autoProcesses);
  useInterval(() => void refreshDetail(), 20_000, autoDetail);

  usePush((p) => {
    if (p.type === "event" && p.event.team === selected && autoDetail) void refreshDetail();
  });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refreshProcesses();
      await refreshDetail();
    } catch (e) {
      notify(`${label}に失敗しました。${errorText(e)}`, "error");
    }
  };

  const start = (teams: string[], phase: number | undefined) => {
    if (!phase) {
      notify("開始するフェーズを選択してください。", "warn");
      return;
    }
    void run("フェーズの開始", () => Promise.all(teams.map((t) => api.start(t, phase))));
  };
  const abort = (teams: string[]) => {
    if (!confirm("演習フェーズを中断しますか?")) return;
    void run("フェーズの中断", () => Promise.all(teams.map((t) => api.abort(t))));
  };
  const resume = (teams: string[]) => void run("再開", () => Promise.all(teams.map((t) => api.resume(t))));

  const restore = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text());
      await api.restoreSnapshots(data);
      notify("状態を復元しました。各チームは一時停止しています。再開してください。");
      await refreshProcesses();
      await refreshDetail();
    } catch (e) {
      notify(`状態の復元に失敗しました。${errorText(e)}`, "error");
    }
  };

  const openInjection = (to?: string) => {
    if (selected && session && session.team !== selected) {
      if (!confirm(`ログイン中のユーザは選択されているチームに所属していません。このインジェクションは${session.team}に送信されます。\n続行しますか?`)) return;
    }
    setInject({ to });
  };

  const allTeams = processes.map((p) => p.team);
  const historyById = useMemo(() => new Map((detail?.history ?? []).map((e) => [e.id, e])), [detail]);
  const openEvent = openId ? historyById.get(openId) : undefined;

  return (
    <section className="view">
      <div className="toolbar wrap">
        <ScenarioBar onActivated={() => location.reload()} />
        <span className="separator" />
        <span>フェーズ:</span>
        <PhasePicker phases={phases} name="phase-all" value={phaseChoice.all} onChange={(p) => setPhaseChoice((c) => ({ ...c, all: p }))} />
        <button type="button" className="ok" title="すべてのチームの演習フェーズを開始します。" onClick={() => start(allTeams, phaseChoice.all)}>
          <span className="fa fa-forward" /> すべて開始
        </button>
        <button type="button" className="danger" title="すべてのチームの演習フェーズを中断します。" onClick={() => abort(allTeams)}>
          <span className="fa fa-minus-square" /> すべて中断
        </button>
        <button type="button" title="すべてのチームの演習の状態を保存します。" onClick={() => api.saveSnapshots().catch((e) => notify(errorText(e), "error"))}>
          <span className="fa fa-download" /> すべて状態を保存
        </button>
        <button type="button" title="保存したデータから演習の状態を復元します。" onClick={() => restoreRef.current?.click()}>
          <span className="fa fa-upload" /> 状態を復元
        </button>
        <input
          ref={restoreRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void restore(f);
          }}
        />
        <label title="チェックすると表示内容を一定時間ごとに自動的に最新化します。">
          <input type="checkbox" checked={autoProcesses} onChange={(e) => setAutoProcesses(e.target.checked)} /> 自動的に更新
        </label>
        <button type="button" onClick={() => void refreshProcesses()} title="表示内容を最新の状態に更新します。">
          すぐに更新
        </button>
      </div>

      {processes.length === 0 ? (
        <Empty>チームが定義されていません。</Empty>
      ) : (
        <div className="table-scroll">
          <table className="data-table process-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>チーム</th>
                <th>シナリオ</th>
                <th>フェーズ</th>
                <th>状態</th>
                <th>スコア</th>
                <th>開始</th>
                <th>経過</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => {
                const wf = p.workflow;
                const running = wf.state === "Started";
                return (
                  <tr
                    key={p.team}
                    className={[selected === p.team ? "selected" : "", running ? "process-running" : "", wf.state === "Aborted" ? "process-aborted" : ""].join(" ")}
                    onClick={() => setSelected(p.team)}
                  >
                    <td>{p.pid}</td>
                    <td title={p.team}>{p.teamName}</td>
                    <td>{scenarioLabel(p.scenario)}</td>
                    <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                      <PhasePicker
                        phases={phases}
                        name={`phase-${p.team}`}
                        value={phaseChoice[p.team]}
                        onChange={(ph) => setPhaseChoice((c) => ({ ...c, [p.team]: ph }))}
                      />
                      {!running && (
                        <button type="button" className="ok small" title="選択したフェーズを開始します。" onClick={() => start([p.team], phaseChoice[p.team])}>
                          <span className="fa fa-forward" /> 開始
                        </button>
                      )}
                      {running && (
                        <button type="button" className="danger small" title="演習フェーズを中断します。" onClick={() => abort([p.team])}>
                          <span className="fa fa-minus-circle" /> 中断
                        </button>
                      )}
                      {(wf.state === "Suspended" || wf.state === "Aborted") && (
                        <button type="button" className="small" title="演習フェーズを再開します。" onClick={() => resume([p.team])}>
                          <span className="fa fa-play-circle" /> 再開
                        </button>
                      )}
                      <button
                        type="button"
                        className="small"
                        title="演習の状態を保存します。"
                        onClick={() => api.saveSnapshots(p.team).catch((e) => notify(errorText(e), "error"))}
                      >
                        <span className="fa fa-download" /> 保存
                      </button>
                    </td>
                    <td>{STATE_LABELS[wf.state]}</td>
                    <td>{wf.score || ""}</td>
                    <td>{wf.start ? formatDate(wf.start) : ""}</td>
                    <td>{wf.start && wf.phase > 0 ? formatSeconds((now - wf.start) / 1000) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="team-panel">
        <div className="toolbar">
          <span className="status-line">{selectedProc ? workflowStatusLine(selectedProc.workflow, now) : "一覧からチームを選択してください。"}</span>
          <span className="spacer" />
          <button type="button" disabled={selectedProc?.workflow.state !== "Started"} title="任意のアクションを実行します。" onClick={() => openInjection()}>
            <span className="fa fa-bolt" /> インジェクション
          </button>
          <label title="チェックすると一覧を一定時間ごとに自動的に更新します。">
            <input type="checkbox" checked={autoDetail} onChange={(e) => setAutoDetail(e.target.checked)} /> 自動的に更新
          </label>
          <button type="button" onClick={() => void refreshDetail()} disabled={!selected}>
            すぐに更新
          </button>
        </div>
        {selectedProc && detail ? (
          <Tabs
            tabs={[
              {
                id: "overview",
                label: "演習シナリオ概要",
                content: () => <TeamOverview workflow={selectedProc.workflow} {...detail} onInject={(role) => openInjection(role)} />,
              },
              {
                id: "history",
                label: `イベント履歴 (${detail.history.length})`,
                content: () => (
                  <EventTable
                    events={detail.history}
                    selectedId={selectedEvent}
                    onSelect={setSelectedEvent}
                    onOpen={setOpenId}
                    pointchest={selectedProc.workflow.pointchest}
                  />
                ),
              },
              { id: "queue", label: `キュー (${detail.queue.length})`, content: () => <QueueTable queue={detail.queue} /> },
              { id: "trigger", label: "トリガ", content: () => <TriggerTable triggers={detail.triggers} start={selectedProc.workflow.start} /> },
            ]}
          />
        ) : (
          <Empty>一覧からチームを選択してください。</Empty>
        )}
      </div>

      {openEvent && (
        <EventDialog event={openEvent} points={selectedProc?.workflow.pointchest[openEvent.id]} onClose={() => setOpenId(undefined)} />
      )}
      {inject && detail && selectedProc && (
        <ActionDialog
          mode="injection"
          presetTo={inject.to}
          cards={detail.actions}
          members={detail.members}
          events={detail.history}
          ownedStates={[]}
          phase={selectedProc.workflow.phase}
          onClose={() => setInject(null)}
          onSent={() => void refreshDetail()}
        />
      )}
    </section>
  );
}
