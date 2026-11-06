import { useEffect, useSyncExternalStore } from 'react';
import type { ForgeStageId } from '../stages';

/**
 * Lets a page claim the active Forge stage(s) while it is mounted, overriding the route default.
 * Example: the Run Console lights `escalate` while a run is crossing its uncertainty boundary:
 *   useForgeStage(crossing ? ['escalate'] : ['execute']);
 */

let override: readonly ForgeStageId[] | null = null;
const listeners = new Set<() => void>();

function set(next: readonly ForgeStageId[] | null): void {
  override = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePageStages(): readonly ForgeStageId[] | null {
  return useSyncExternalStore(subscribe, () => override);
}

export function useForgeStage(stages: readonly ForgeStageId[] | null): void {
  const key = stages ? stages.join(',') : '';
  useEffect(() => {
    set(key ? (key.split(',') as ForgeStageId[]) : null);
    return () => {
      set(null);
    };
  }, [key]);
}
