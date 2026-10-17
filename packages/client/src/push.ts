import { useEffect, useRef } from "react";
import type { ServerPush } from "@imane/shared";

type Listener = (p: ServerPush) => void;
const listeners = new Set<Listener>();

/** WebSocket で受け取ったプッシュ通知を画面に配る */
export const pushBus = {
  emit(p: ServerPush): void {
    for (const l of listeners) l(p);
  },
  on(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function usePush(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => pushBus.on((p) => ref.current(p)), []);
}

/** 一定間隔で処理を呼ぶ(enabled が false の間は止める) */
export function useInterval(fn: () => void, ms: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}
