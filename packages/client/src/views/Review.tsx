import type { MemberWithPresence, NotificationMessage, ScenarioSetting, WorkflowSummary } from "@imane/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, saveBlob } from "../api";
import { Empty } from "../components/ui";
import { errorText, useApp } from "../context";
import { formatDate } from "../format";
import { buildSequence } from "../sequence";

interface Loaded {
  team: string;
  events: NotificationMessage[];
  members: MemberWithPresence[];
  workflow: WorkflowSummary;
}

let renderSeq = 0;

async function renderMermaid(text: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    sequence: {
      mirrorActors: false,
      diagramMarginX: 20,
      diagramMarginY: 5,
      boxTextMargin: 5,
      noteMargin: 5,
      messageMargin: 5,
    },
  });
  const { svg } = await mermaid.render(`sequence-${++renderSeq}`, text);
  return svg;
}

export function ReviewView() {
  const { session, notify, stateById } = useApp();
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [team, setTeam] = useState(session?.team ?? "");
  const [setting, setSetting] = useState<ScenarioSetting>();
  const [data, setData] = useState<Loaded | null>(null);
  const [hideInactive, setHideInactive] = useState(true);
  const [hideTalk, setHideTalk] = useState(true);
  const [compact, setCompact] = useState(false);
  const [hiddenRoles, setHiddenRoles] = useState<Set<string>>(new Set());
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState(false);
  const [svg, setSvg] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!session?.isadmin) {
      setTeams(session ? [{ id: session.team, name: session.team }] : []);
      return;
    }
    Promise.all([api.processes(), api.scenarios()]).then(
      ([procs, scenarios]) => {
        setTeams(procs.map((p) => ({ id: p.team, name: p.teamName })));
        setSetting(scenarios.find((s) => s.active)?.setting);
      },
      (e) => notify(errorText(e), "error"),
    );
  }, [session, notify]);

  const load = useCallback(async () => {
    if (!team) return;
    try {
      const [events, members, workflow] = await Promise.all([api.history(team), api.members(team), api.workflow(team)]);
      setData({ team, events, members, workflow });
    } catch (e) {
      notify(`履歴の取得に失敗しました。${errorText(e)}`, "error");
    }
  }, [team, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const generated = useMemo(() => {
    if (!data) return "";
    const visibleRoles = new Set(data.members.map((m) => m.role).filter((r) => !hiddenRoles.has(r)));
    return buildSequence(data.events, data.members, {
      visibleRoles,
      hideInactive,
      hideTalk,
      compact,
      rolesOrder: setting?.["roles-order"],
      stateName: (id) => stateById(id)?.name ?? id,
      pointNames: (id) => (data.workflow.pointchest[id] ?? []).map((p) => p.name || p.id),
    });
  }, [data, hiddenRoles, hideInactive, hideTalk, compact, setting, stateById]);

  useEffect(() => {
    if (!editing) setSource(generated);
  }, [generated, editing]);

  const draw = useCallback(
    async (text: string) => {
      if (!text) return;
      try {
        setSvg(await renderMermaid(text));
      } catch (e) {
        notify(`シーケンス図の描画に失敗しました。${errorText(e)}`, "error");
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!editing) void draw(generated);
  }, [generated, editing, draw]);

  const toggleRole = (role: string) =>
    setHiddenRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  return (
    <section className="view">
      <div className="toolbar wrap">
        <label>
          チーム:{" "}
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">選択してください。</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void load()} title="演習の履歴を読み直してシーケンス図を表示します。">
          <span className="fa fa-refresh" /> 表示
        </button>
        <span className="separator" />
        <label title="フェーズ中にアクションのなかったユーザを非表示にします。">
          <input type="checkbox" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} />{" "}
          非アクティブなユーザを隠す
        </label>
        <label title="「話し合い」アクションを非表示にします。">
          <input type="checkbox" checked={hideTalk} onChange={(e) => setHideTalk(e.target.checked)} />{" "}
          「話し合い」を隠す
        </label>
        <label title="イベントを短縮して表示します。">
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> 短縮して表示
        </label>
        <span className="spacer" />
        <button type="button" className="icon-button" title="拡大" onClick={() => setZoom((z) => Math.min(4, z + 0.1))}>
          <span className="fa fa-search-plus" />
        </button>
        <button
          type="button"
          className="icon-button"
          title="縮小"
          onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
        >
          <span className="fa fa-search-minus" />
        </button>
        <button type="button" onClick={() => setZoom(1)} title="元のサイズに戻します。">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="シーケンス図の定義を編集します。" onClick={() => setEditing((v) => !v)}>
          <span className="fa fa-edit" /> {editing ? "編集を終了" : "編集"}
        </button>
        <button
          type="button"
          disabled={!svg}
          title="表示中のシーケンス図をSVGファイルとして保存します。"
          onClick={() => saveBlob(new Blob([svg], { type: "image/svg+xml" }), `sequence.${data?.team ?? "team"}.svg`)}
        >
          <span className="fa fa-download" /> SVGを保存
        </button>
      </div>

      {data && (
        <div className="role-filter">
          {data.members.map((m) => (
            <label key={m.role}>
              <input type="checkbox" checked={!hiddenRoles.has(m.role)} onChange={() => toggleRole(m.role)} />{" "}
              {m.rolename}
            </label>
          ))}
        </div>
      )}

      {editing && (
        <div className="editor">
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={12}
            aria-label="シーケンス図の定義"
          />
          <button type="button" onClick={() => void draw(source)}>
            <span className="fa fa-refresh" /> 更新
          </button>
        </div>
      )}

      {data ? (
        <>
          <div className="diagram-header">
            {data.team} フェーズ:{data.workflow.phase || "未開始"} ({formatDate(Date.now())}) スコア:
            {data.workflow.score}
          </div>
          <div className="diagram-scroll">
            {/* mermaid は securityLevel: strict で描画しているため、生成した SVG をそのまま埋め込む */}
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 上記のとおり mermaid が生成した SVG */}
            <div className="diagram" style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </>
      ) : (
        <Empty>チームを選択してください。</Empty>
      )}
    </section>
  );
}
