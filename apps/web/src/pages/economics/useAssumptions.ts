import { useEffect, useState } from 'react';

/** `value` after it has stopped changing for `delayMs`. The first value is returned immediately. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}

export interface Assumptions {
  /** Null until the person changes it: the server then answers with its saved default. */
  executions: number | null;
  /** Null until the person flips it: the server then uses its saved default. */
  conservative: boolean | null;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = { executions: null, conservative: null };

/** The query parameters for `GET /api/economics`: only what the person actually changed. */
export function assumptionParams(
  executions: number | null,
  conservative: boolean | null,
): { executions?: number; conservative?: boolean } {
  return {
    ...(executions !== null ? { executions } : {}),
    ...(conservative !== null ? { conservative } : {}),
  };
}
