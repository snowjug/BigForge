import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import {
  type GovernanceTab,
  type RunParams,
  parseDriftParams,
  parseGovernanceParams,
  parseLearnParams,
  parseRunParams,
  parseShadowParams,
} from './routes';

/**
 * Hooks over the query-string convention in routes.ts. Each returns the parsed ids and a setter that
 * keeps the other parameters, replaces the history entry (selection is not navigation) and drops empty values.
 */

function useParamSetter() {
  const [, setSearch] = useSearchParams();
  return useCallback(
    (patch: Record<string, string | null | undefined>) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );
}

/** `/run?task=<taskId>&run=<runId>` */
export function useRunParams(): RunParams & { setParams: (patch: Partial<RunParams>) => void } {
  const [search] = useSearchParams();
  const set = useParamSetter();
  return { ...parseRunParams(search), setParams: set };
}

/** `/learn?family=<familyId>` */
export function useLearnParams() {
  const [search] = useSearchParams();
  const set = useParamSetter();
  return {
    ...parseLearnParams(search),
    setFamily: (family: string | null) => {
      set({ family });
    },
  };
}

/** `/shadow?version=<reflexVersionId>` */
export function useShadowParams() {
  const [search] = useSearchParams();
  const set = useParamSetter();
  return {
    ...parseShadowParams(search),
    setVersion: (version: string | null) => {
      set({ version });
    },
  };
}

/** `/drift?version=<reflexVersionId>` */
export function useDriftParams() {
  const [search] = useSearchParams();
  const set = useParamSetter();
  return {
    ...parseDriftParams(search),
    setVersion: (version: string | null) => {
      set({ version });
    },
  };
}

/** `/governance?tab=audit|approvals|roles|safety` */
export function useGovernanceParams() {
  const [search] = useSearchParams();
  const set = useParamSetter();
  return {
    ...parseGovernanceParams(search),
    setTab: (tab: GovernanceTab) => {
      set({ tab });
    },
  };
}
