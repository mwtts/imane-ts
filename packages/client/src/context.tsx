import type { SessionData, StateData } from "@imane/shared";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type ToastLevel = "info" | "warn" | "error";
export interface Toast {
  id: number;
  text: string;
  level: ToastLevel;
}

interface AppState {
  session: SessionData | null;
  setSession: (s: SessionData | null) => void;
  /** ステートカード定義 */
  states: StateData[];
  setStates: (s: StateData[]) => void;
  stateById: (id: string) => StateData | undefined;
  toasts: Toast[];
  notify: (text: string, level?: ToastLevel) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<AppState | null>(null);

let toastSeq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [states, setStates] = useState<StateData[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (text: string, level: ToastLevel = "info") => {
      const id = ++toastSeq;
      setToasts((t) => [...t.slice(-4), { id, text, level }]);
      if (level !== "error") setTimeout(() => dismiss(id), 10_000);
    },
    [dismiss],
  );

  const value = useMemo<AppState>(() => {
    const index = new Map(states.map((s) => [s.id, s]));
    return { session, setSession, states, setStates, stateById: (id) => index.get(id), toasts, notify, dismiss };
  }, [session, states, toasts, notify, dismiss]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider がありません");
  return v;
}

/** エラーを通知に変換する */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
