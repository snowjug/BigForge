import { useSyncExternalStore } from 'react';

/**
 * Appearance preferences, stored in localStorage and mirrored onto <html> as `data-theme` and
 * `data-motion` (read by tokens.css / base.css). public/theme-init.js applies the same values before
 * first paint, so keep the storage keys in sync.
 */
export type Theme = 'dark' | 'light';
/** `system` follows the OS `prefers-reduced-motion` setting. */
export type MotionPreference = 'system' | 'reduced' | 'full';

const THEME_KEY = 'bf.theme';
const MOTION_KEY = 'bf.motion';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

interface Snapshot {
  theme: Theme;
  motion: MotionPreference;
  /** The effective result: user preference first, then the OS setting. */
  reducedMotion: boolean;
}

const listeners = new Set<() => void>();

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota). The preference then lasts for this session only.
  }
}

const mediaQuery: MediaQueryList | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_QUERY)
    : null;

function compute(theme: Theme, motion: MotionPreference): Snapshot {
  const reducedMotion =
    motion === 'reduced' || (motion === 'system' && Boolean(mediaQuery?.matches));
  return { theme, motion, reducedMotion };
}

function initial(): Snapshot {
  const theme: Theme = readStorage(THEME_KEY) === 'light' ? 'light' : 'dark';
  const stored = readStorage(MOTION_KEY);
  const motion: MotionPreference = stored === 'reduced' || stored === 'full' ? stored : 'system';
  return compute(theme, motion);
}

let snapshot: Snapshot = initial();

function applyToDocument(next: Snapshot): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', next.theme);
  root.setAttribute('data-motion', next.reducedMotion ? 'reduced' : 'full');
}

function commit(next: Snapshot): void {
  snapshot = next;
  applyToDocument(next);
  for (const listener of listeners) listener();
}

applyToDocument(snapshot);
mediaQuery?.addEventListener('change', () => {
  commit(compute(snapshot.theme, snapshot.motion));
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): Snapshot => snapshot;

export function setTheme(theme: Theme): void {
  writeStorage(THEME_KEY, theme);
  commit(compute(theme, snapshot.motion));
}

export function setMotionPreference(motion: MotionPreference): void {
  writeStorage(MOTION_KEY, motion === 'system' ? null : motion);
  commit(compute(snapshot.theme, motion));
}

export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
} {
  const { theme } = useSyncExternalStore(subscribe, getSnapshot);
  return {
    theme,
    setTheme,
    toggleTheme: () => {
      setTheme(theme === 'dark' ? 'light' : 'dark');
    },
  };
}

/** `reduced` is the effective value. JS-driven animation (counters, playback) must honour it. */
export function useMotion(): {
  reduced: boolean;
  preference: MotionPreference;
  setPreference: (motion: MotionPreference) => void;
  toggleReduced: () => void;
} {
  const { reducedMotion, motion } = useSyncExternalStore(subscribe, getSnapshot);
  return {
    reduced: reducedMotion,
    preference: motion,
    setPreference: setMotionPreference,
    toggleReduced: () => {
      setMotionPreference(reducedMotion ? 'full' : 'reduced');
    },
  };
}

/** Convenience for components that only need the boolean. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot).reducedMotion;
}
