import { useSyncExternalStore } from 'react';

/**
 * UI state of the guided demo (is the presenter open, presentation layout, collapsed), kept in
 * sessionStorage so a reload mid-demo keeps the presenter. The demo's *progress* lives on the server
 * (GET /api/demo); this store only remembers how the presenter is being shown.
 * public/theme-init.js reads the same keys to avoid a chrome flash.
 */

interface DemoUi {
  open: boolean;
  /** Hides the rail and Forge strip and enlarges type. Only meaningful while `open`. */
  presentation: boolean;
  /** Shrinks the presenter bar to one line. */
  collapsed: boolean;
}

const OPEN = 'bf.demo.open';
const PRESENTATION = 'bf.presentation';
const COLLAPSED = 'bf.demo.collapsed';

const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage can be unavailable; the presenter then resets on reload, nothing else is affected.
  }
};

let state: DemoUi = {
  open: read(OPEN) === '1',
  presentation: read(PRESENTATION) === 'on',
  collapsed: read(COLLAPSED) === '1',
};
const listeners = new Set<() => void>();

function applyToDocument(next: DemoUi): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (next.open && next.presentation) root.setAttribute('data-presentation', 'on');
  else root.removeAttribute('data-presentation');
}

function commit(next: DemoUi): void {
  state = next;
  write(OPEN, next.open ? '1' : '0');
  write(PRESENTATION, next.presentation ? 'on' : 'off');
  write(COLLAPSED, next.collapsed ? '1' : '0');
  applyToDocument(next);
  for (const listener of listeners) listener();
}

applyToDocument(state);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const demoUi = {
  open: () => {
    commit({ ...state, open: true });
  },
  /** Closing the presenter always restores the normal layout. */
  close: () => {
    commit({ open: false, presentation: false, collapsed: false });
  },
  setPresentation: (presentation: boolean) => {
    commit({ ...state, presentation });
  },
  setCollapsed: (collapsed: boolean) => {
    commit({ ...state, collapsed });
  },
};

export function useDemoUi(): DemoUi {
  return useSyncExternalStore(subscribe, () => state);
}
