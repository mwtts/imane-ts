import type { AvailableCard, MemberWithPresence, NotificationMessage, StateData, WorkflowSummary } from "@imane/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { ActionDialog, type ActionMode } from "../components/ActionDialog";
import { EventDialog } from "../components/EventDialog";
import { EventTable } from "../components/EventTable";
import { HelpDialog } from "../components/HelpDialog";
import { EffectDialog } from "../components/ui";
import { errorText, useApp } from "../context";
import { eventStateIds, isHiddenEvent, workflowStatusLine } from "../format";
import { useInterval, usePush } from "../push";

interface DialogState {
  mode: ActionMode;
  source?: NotificationMessage;
}

export function ParticipantView() {
  const { session, notify, stateById } = useApp();
  const team = session?.team ?? "";
  const [events, setEvents] = useState<NotificationMessage[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [members, setMembers] = useState<MemberWithPresence[]>([]);
  const [cards, setCards] = useState<AvailableCard[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [help, setHelp] = useState(false);
  const [effect, setEffect] = useState<StateData | null>(null);
  const [now, setNow] = useState(Date.now());
  /** 演出効果を再生済みのステート */
  const seenStates = useRef(new Set<string>());

  const refreshStatus = useCallback(async () => {
    if (!team) return;
    try {
      const [wf, ms, cs] = await Promise.all([api.workflow(team), api.members(team), api.actions()]);
      setWorkflow(wf);
      setMembers(ms);
      setCards(cs);
    } catch (e) {
      notify(errorText(e), "warn");
    }
  }, [team, notify]);

  const loadHistory = useCallback(async () => {
    if (!team) return;
    try {
      const history = await api.history(team);
      for (const m of history) for (const id of eventStateIds(m)) seenStates.current.add(id);
      setEvents(history);
    } catch (e) {
      notify(`履歴の取得に失敗しました。${errorText(e)}`, "error");
    }
    await refreshStatus();
  }, [team, notify, refreshStatus]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useInterval(() => setNow(Date.now()), 1000);
  useInterval(() => void refreshStatus(), 20_000, !!team);

  // 新しいイベントの受信。初めて手に入れたステートに演出効果があれば再生する
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  usePush((p) => {
    if (p.type === "presence") {
      setMembers((prev) =>
        p.members.map((m) => ({ ...m, availableStates: prev.find((x) => x.email === m.email)?.availableStates ?? [] })),
      );
      return;
    }
    if (p.type !== "event" || p.event.team !== team) return;
    const ev = p.event;
    if (ev.action.type === "alert") {
      notify(`システムからの警告: ${ev.message}`, "warn");
      return;
    }
    setEvents((prev) => (prev.some((m) => m.id === ev.id) ? prev : [...prev, ev]));
    if (!isHiddenEvent(ev)) {
      for (const id of eventStateIds(ev)) {
        if (seenStates.current.has(id)) continue;
        seenStates.current.add(id);
        const s = stateById(id);
        if (s?.effect) setEffect(s);
      }
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void refreshStatus(), 500);
  });

  const me = members.find((m) => m.email === session?.userid);
  const running = workflow?.state === "Started";
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const sentCount = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of events)
      if (e.from.email === session?.userid && !e.reply) c[e.action.id] = (c[e.action.id] ?? 0) + 1;
    return c;
  }, [events, session]);
  const openEvent = openId ? byId.get(openId) : undefined;

  const openAction = (mode: ActionMode, source?: NotificationMessage) => {
    if (mode === "reply" && !source) {
      notify("返信先が選択されていません。", "warn");
      return;
    }
    setDialog({ mode, source });
  };

  const liveTitle = running ? undefined : "この機能は演習フェーズ中のみ使用できます。";

  return (
    <section className="view">
      <div className="toolbar">
        <button
          type="button"
          disabled={!running}
          title={liveTitle ?? "新規アクションを実行します。"}
          onClick={() => openAction("new")}
        >
          <span className="fa fa-mail-forward" /> 新規アクション
        </button>
        <button
          type="button"
          disabled={!running}
          title={liveTitle ?? "選択されたイベントに返信します。"}
          onClick={() => openAction("reply", selectedId ? byId.get(selectedId) : undefined)}
        >
          <span className="fa fa-mail-reply" /> 返信/回答
        </button>
        <button type="button" title="イベント一覧を更新します。" onClick={() => void loadHistory()}>
          <span className="fa fa-refresh" /> 一覧更新
        </button>
        <span className="spacer" />
        <span className="muted">ヘルプ:</span>
        <a
          className="button"
          href={`${import.meta.env.BASE_URL}image/configurations.jpg`}
          target="_blank"
          rel="noreferrer"
          title="シナリオの前提となるシステム構成の説明図"
        >
          システム構成
        </a>
        <a
          className="button"
          href={`${import.meta.env.BASE_URL}image/organization.jpg`}
          target="_blank"
          rel="noreferrer"
          title="組織構成と連絡ルートの説明図"
        >
          組織と連絡ルート
        </a>
        <button type="button" onClick={() => setHelp(true)} title="シナリオで定義された役割とアクション">
          役割とアクション
        </button>
      </div>

      <div className="status-line" aria-live="polite">
        {workflow ? workflowStatusLine(workflow, now) : "演習の状態を取得しています。"}
      </div>

      <div className="presence">
        {members
          .filter((m) => !m.hidden)
          .map((m) => (
            <span
              key={m.email}
              className={`presence-chip ${m.online ? "online" : "offline"}`}
              title={`${m.name} (${m.email}) ${m.desc ?? ""}`}
            >
              <span className={`fa ${m.online ? "fa-circle" : "fa-circle-o"}`} />
              {m.rolename}
              {m.email === session?.userid && <span className="fa fa-user" title="ログイン中のユーザです。" />}
            </span>
          ))}
      </div>

      <EventTable
        events={events}
        selfEmail={session?.userid}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpen={setOpenId}
        onPlay={setEffect}
        pointchest={workflow?.pointchest}
      />

      {openEvent && (
        <EventDialog
          event={openEvent}
          points={workflow?.pointchest[openEvent.id]}
          onClose={() => setOpenId(undefined)}
          onPlay={setEffect}
          onReply={
            running
              ? (e) => {
                  setOpenId(undefined);
                  openAction("reply", e);
                }
              : undefined
          }
        />
      )}
      {dialog && (
        <ActionDialog
          mode={dialog.mode}
          replySource={dialog.source}
          cards={cards}
          members={members}
          events={events.filter((e) => !isHiddenEvent(e))}
          ownedStates={me?.availableStates ?? []}
          phase={workflow?.phase ?? 0}
          sentCount={sentCount}
          onClose={() => setDialog(null)}
          onSent={() => void refreshStatus()}
        />
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {effect && <EffectDialog state={effect} onClose={() => setEffect(null)} />}
    </section>
  );
}
