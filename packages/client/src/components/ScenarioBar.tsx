import type { ScenarioInfo, ValidationResult } from "@imane/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { errorText, useApp } from "../context";
import { formatSeconds, scenarioLabel } from "../format";
import { Modal } from "./ui";

function ValidationList({ results }: { results: ValidationResult[] }) {
  return (
    <ul className="validation">
      {results.map((r) => (
        <li key={r.label} className={r.valid ? "ok" : "ng"}>
          <span className={`fa ${r.valid ? "fa-check" : "fa-exclamation-triangle"}`} /> {r.label}:{" "}
          {r.valid ? `正常（${r.params?.count ?? 0}個の要素）` : "異常あり"}
          {r.params?.actions !== undefined && <span className="muted"> 専用アクション {r.params.actions}</span>}
          {r.params?.autoaction !== undefined && <span className="muted"> 自動アクション {r.params.autoaction}</span>}
          {r.error && <div className="input-error">{r.error}</div>}
        </li>
      ))}
    </ul>
  );
}

function ScenarioDetail({ info, onClose }: { info: ScenarioInfo; onClose: () => void }) {
  const { notify } = useApp();
  const [results, setResults] = useState(info.validation);
  const s = info.setting;
  const row = (label: string, value?: string) => (
    <tr>
      <th>{label}</th>
      <td>{value ?? ""}</td>
    </tr>
  );
  return (
    <Modal
      title={`シナリオセット: ${scenarioLabel(info.name)}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => api.validateScenario(info.name).then(setResults, (e) => notify(errorText(e), "error"))}
          >
            検証
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </>
      }
    >
      {info.error && <div className="input-error">{info.error}</div>}
      <table className="form-table">
        <tbody>
          {row("名前", s?.name)}
          {row("説明", s?.description)}
          {row("作成者", s?.author)}
          {row("Copyright", s?.copyright)}
          {row("バージョン", s?.version)}
          {row("作成日時", s?.created)}
          {row("更新日時", s?.updated)}
          {row("チーム", s?.teams.map((t) => `${t.name} (${t.id})`).join(", "))}
        </tbody>
      </table>
      <h3>フェーズ</h3>
      <ul>
        {s?.phases.map((p) => (
          <li key={p.phase}>
            フェーズ{p.phase} {p.description} {p.timelimit ? `制限時間 ${formatSeconds(p.timelimit)}` : ""}
          </li>
        ))}
      </ul>
      <h3>検証結果</h3>
      <ValidationList results={results} />
    </Modal>
  );
}

export function ScenarioBar({ onActivated }: { onActivated: () => void }) {
  const { notify } = useApp();
  const [list, setList] = useState<ScenarioInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ScenarioInfo | null>(null);
  const [uploadResult, setUploadResult] = useState<ValidationResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      const l = await api.scenarios();
      setList(l);
      setSelected((cur) => cur || l.find((s) => s.active)?.name || "_default_");
    } catch (e) {
      notify(errorText(e), "error");
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時に一度だけ読み込む
  useEffect(() => {
    void reload();
  }, []);

  const active = list.find((s) => s.active);
  const current = list.find((s) => s.name === selected);

  const activate = async () => {
    if (!current) return;
    if (
      current.name !== active?.name &&
      !confirm("シナリオセットを変更すると、進行中のフェーズが破棄されます。\n続行しますか?")
    )
      return;
    try {
      await api.activateScenario(current.name);
      notify("シナリオセットを変更しました。");
      onActivated();
    } catch (e) {
      notify(`シナリオセットの有効化に失敗しました。${errorText(e)}`, "error");
    }
  };

  const upload = async (file: File) => {
    try {
      if (/\.zip$/i.test(file.name)) {
        const name = file.name.replace(/\.zip$/i, "");
        if (!confirm(`シナリオセット「${name}」をアップロードします。同名のシナリオセットは置き換えられます。`)) return;
        const r = await api.uploadScenarioArchive(name, file);
        setUploadResult(r.validation);
        notify(
          r.installed ? "シナリオセットを登録しました。" : "シナリオデータにエラーがあるため登録しませんでした。",
          r.installed ? "info" : "error",
        );
      } else {
        const target = current?.name ?? "_default_";
        if (!confirm(`シナリオセット「${scenarioLabel(target)}」の ${file.name} を置き換えます。`)) return;
        setUploadResult(await api.uploadScenarioFile(target, file.name, file));
        notify("シナリオデータをアップロードしました。");
      }
      await reload();
    } catch (e) {
      notify(`アップロードに失敗しました。${errorText(e)}`, "error");
    }
  };

  return (
    <div className="scenario-bar">
      <label>
        シナリオセット:{" "}
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {list.map((s) => (
            <option
              key={s.name}
              value={s.name}
              title={s.validation.some((v) => !v.valid) ? "エラーあり" : s.setting?.description}
            >
              {scenarioLabel(s.name)}
              {s.active ? "（有効）" : ""}
              {s.validation.some((v) => !v.valid) ? "（エラー）" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-button"
        title="選択したシナリオセットの詳細を表示します。"
        onClick={() => current && setDetail(current)}
      >
        <span className="fa fa-file-text-o" />
      </button>
      <button
        type="button"
        className="icon-button"
        title="選択したシナリオセットを有効化します。"
        onClick={() => void activate()}
      >
        <span className="fa fa-check-square-o" />
      </button>
      <button
        type="button"
        className="icon-button"
        title="シナリオセットの一覧を更新します。"
        onClick={() => void reload()}
      >
        <span className="fa fa-refresh" />
      </button>
      <button
        type="button"
        className="icon-button"
        title="シナリオセットをダウンロードします。"
        onClick={() => current && api.downloadScenario(current.name).catch((e) => notify(errorText(e), "error"))}
      >
        <span className="fa fa-download" />
      </button>
      <button
        type="button"
        className="icon-button"
        title="シナリオセット(.zip)またはシナリオデータ(.json)をアップロードします。"
        onClick={() => fileRef.current?.click()}
      >
        <span className="fa fa-upload" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      {detail && <ScenarioDetail info={detail} onClose={() => setDetail(null)} />}
      {uploadResult && (
        <Modal title="アップロード結果" onClose={() => setUploadResult(null)}>
          <ValidationList results={uploadResult} />
        </Modal>
      )}
    </div>
  );
}
