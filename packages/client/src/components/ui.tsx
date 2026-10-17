import { useEffect, useRef, useState, type ReactNode } from "react";
import { OPERATORS, type StateData } from "@imane/shared";
import { useApp } from "../context";

// ------------------------------------------------------------------ Modal

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "normal" | "wide";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${props.size === "wide" ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <header className="modal-header">
        <h2>{props.title}</h2>
        <button type="button" className="icon-button" onClick={props.onClose} aria-label="閉じる">
          <span className="fa fa-times" />
        </button>
      </header>
      <div className="modal-body">{props.children}</div>
      {props.footer && <footer className="modal-footer">{props.footer}</footer>}
    </dialog>
  );
}

// ------------------------------------------------------------------ state cards

export type ChipKind = "state" | "add" | "remove" | "condition";

const KIND_ICON: Record<ChipKind, { icon: string; title: string }> = {
  state: { icon: "fa-paperclip", title: "このステートがイベントに添付されます。" },
  add: { icon: "fa-plus", title: "システムステートに追加されます。" },
  remove: { icon: "fa-minus", title: "システムステートから削除されます。" },
  condition: { icon: "fa-question", title: "システムステートの条件です。" },
};

export function StateChip({ id, kind = "state", onPlay }: { id: string; kind?: ChipKind; onPlay?: (s: StateData) => void }) {
  const { stateById } = useApp();
  const s = stateById(id);
  const label = s?.name || id;
  const title = s ? `${s.name ?? ""} ${s.description ?? ""} (${id})` : `未定義のステート (${id})`;
  return (
    <span className={`chip chip-${kind} ${s?.type ? `chip-type${s.type}` : ""}`} title={title}>
      {kind !== "state" && <span className={`fa ${KIND_ICON[kind].icon}`} title={KIND_ICON[kind].title} />}
      {s?.icon && <span className={`fa ${s.icon}`} />}
      {label}
      {s?.effect && onPlay && (
        <button type="button" className="chip-play" title="演出効果を再生します。" onClick={() => onPlay(s)}>
          <span className="fa fa-caret-square-o-right" />
        </button>
      )}
    </span>
  );
}

export function StateChips(props: { ids?: readonly string[]; kind?: ChipKind; onPlay?: (s: StateData) => void }) {
  if (!props.ids || props.ids.length === 0) return null;
  return (
    <>
      {props.ids.map((id) => (
        <StateChip key={`${props.kind}-${id}`} id={id} kind={props.kind} onPlay={props.onPlay} />
      ))}
    </>
  );
}

/** ステート条件の表示。演算子と式をそのまま見せ、ステートIDは名前に置き換える */
export function ConditionChips({ cond }: { cond?: readonly string[] }) {
  const { stateById } = useApp();
  if (!cond || cond.length === 0) return null;
  return (
    <span className="condition">
      {cond.map((c, i) => {
        if ((OPERATORS as readonly string[]).includes(c)) {
          return (
            <span key={i} className="operator">
              {c}
            </span>
          );
        }
        if (c.includes("(")) {
          const text = c.replace(/[^(),\s]+/g, (tok) => {
            const s = stateById(tok);
            return s?.name ? `${s.name}` : tok;
          });
          return (
            <code key={i} title={c}>
              {text}
            </code>
          );
        }
        return <StateChip key={i} id={c} kind="condition" />;
      })}
    </span>
  );
}

// ------------------------------------------------------------------ effects

/**
 * ステートカードの演出効果。"href:URL" はそのページを、"html:..." はその内容を
 * スクリプトを実行できない iframe に表示する。
 */
export function EffectDialog({ state, onClose }: { state: StateData; onClose: () => void }) {
  const effect = state.effect ?? "";
  let frame: ReactNode = <p>この演出効果には対応していません。</p>;
  if (effect.startsWith("href:")) {
    frame = <iframe className="effect-frame" sandbox="" src={effect.slice("href:".length)} title={state.name ?? state.id} />;
  } else if (effect.startsWith("html:")) {
    frame = <iframe className="effect-frame" sandbox="" srcDoc={effect.slice("html:".length)} title={state.name ?? state.id} />;
  }
  return (
    <Modal title={`イベント発生: ${state.name ?? state.id}`} onClose={onClose}>
      {frame}
    </Modal>
  );
}

// ------------------------------------------------------------------ tabs

export function Tabs(props: { tabs: Array<{ id: string; label: string; content: () => ReactNode }>; onChange?: (id: string) => void }) {
  const [active, setActive] = useState(props.tabs[0]?.id ?? "");
  const current = props.tabs.find((t) => t.id === active) ?? props.tabs[0];
  return (
    <div className="tabs">
      <div className="tab-list" role="tablist">
        {props.tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === current?.id}
            className={t.id === current?.id ? "tab active" : "tab"}
            onClick={() => {
              setActive(t.id);
              props.onChange?.(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel">
        {current?.content()}
      </div>
    </div>
  );
}

export function Empty({ children = "表示情報がありません。" }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}
