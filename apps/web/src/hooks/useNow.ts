import { useSyncExternalStore } from 'react';

const TICK_MS = 10_000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * The current time in ms, refreshed every 10 s while any component uses it. Use it with
 * `relativeTime(iso, now)` so render functions stay pure.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}
