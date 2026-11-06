import type {
  DemoContext as DemoContextData,
  DemoStateDto,
  DemoStepDto,
  JobDto,
  PersonaDto,
} from '@bigforge/schemas';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import {
  type DemoSeedStage,
  useDemoGoto,
  useDemoPerform,
  useDemoReset,
  useDemoSeed,
  useDemoState,
  useLogin,
  usePersonas,
} from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { demoRoute } from './demoRoute';
import { nextBlockedReason } from './scenes';
import { demoUi, useDemoUi } from './session';

export interface DemoApi {
  /** The deployment runs in demo mode. In production the server has no demo endpoints, so every demo control hides. */
  available: boolean;
  /** `GET /api/demo`. Undefined until loaded (or while identity changes). */
  state: DemoStateDto | undefined;
  isLoading: boolean;
  loadError: unknown;
  steps: readonly DemoStepDto[];
  /** The step the presenter is on (1-based) and the total (25). */
  step: number;
  total: number;
  current: DemoStepDto | undefined;
  context: DemoContextData | undefined;

  /** The presenter bar is showing. */
  open: boolean;
  /** Chrome hidden, larger type. */
  presentation: boolean;
  collapsed: boolean;

  /** An action is running on the server (poll `activeJob` for progress). */
  busy: boolean;
  activeJob: JobDto | null;
  /** The last failure, ready to show in the bar. */
  error: unknown;
  clearError: () => void;

  /** Roles: running actions needs `run_task`, the human step needs `promote`. */
  canRun: boolean;
  canPromote: boolean;
  /** Why Next is unavailable on this step (null when it is available). */
  nextBlocked: string | null;
  /** A reviewer persona in the signed-in user's tenant, for the "Switch to Grace" control. */
  reviewerPersona: PersonaDto | null;

  /** Opens the presenter (optionally at a step) and navigates to the step's page. */
  start: (step?: number) => Promise<void>;
  exit: () => void;
  next: () => Promise<void>;
  back: () => Promise<void>;
  restart: () => Promise<void>;
  goto: (step: number) => Promise<void>;
  /** Performs the current step's real work (idempotent; runs unfinished earlier steps first). */
  performCurrent: () => Promise<void>;
  seed: (stage: DemoSeedStage) => Promise<void>;
  /** Admin only: recreates the database and starts a new audit chain. */
  reset: () => Promise<void>;
  switchToReviewer: () => Promise<void>;
  togglePresentation: () => void;
  toggleCollapsed: () => void;
}

const DemoContext = createContext<DemoApi | null>(null);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
  return (
    target.closest(
      '[role="tablist"], [role="slider"], [role="listbox"], [role="menu"], [role="grid"]',
    ) !== null
  );
}

function useDemoController(): DemoApi {
  const navigate = useNavigate();
  const auth = useAuth();
  const ui = useDemoUi();
  const performMutation = useDemoPerform();
  const gotoMutation = useDemoGoto();
  const seedMutation = useDemoSeed();
  const resetMutation = useDemoReset();
  const login = useLogin();
  const personas = usePersonas();
  const [error, setError] = useState<unknown>(null);

  const busy = performMutation.isPending || seedMutation.isPending || resetMutation.isPending;
  const available = !auth.isLoading && auth.isDemo;
  const query = useDemoState({ poll: busy, enabled: available });
  const state = available ? query.data : undefined;
  const current = state?.steps.find((step) => step.n === state.step);
  const open = available && ui.open;

  const canRun = auth.can('run_task');
  const canPromote = auth.can('promote');

  const reviewerPersona =
    personas.data?.personas.find(
      (persona) => persona.role === 'reviewer' && persona.tenant.slug === auth.user?.tenant.slug,
    ) ?? null;

  // A presenter left open in sessionStorage must not outlive a production deployment (it would hide the chrome).
  const productionMode = !auth.isLoading && !auth.isDemo;
  useEffect(() => {
    if (productionMode) demoUi.close();
  }, [productionMode]);

  /* ---- follow the story: navigate to the step's page when the step (or its ids) change ---- */
  const target = open && current && state ? demoRoute(current, state.context) : null;
  const lastTarget = useRef<string | null>(null);
  const lastStep = useRef<string | null>(null);
  const resumed = useRef(ui.open);
  useEffect(() => {
    if (!target || !current) {
      lastTarget.current = null;
      lastStep.current = null;
      return;
    }
    if (lastTarget.current === target) return;
    const sameStep = lastStep.current === current.id;
    const firstAfterReload = lastTarget.current === null && resumed.current;
    lastTarget.current = target;
    lastStep.current = current.id;
    resumed.current = false;
    // A reload mid-demo keeps the page the presenter was on; a step change pushes history, an id
    // appearing within the same step (an action finished) replaces it.
    if (!firstAfterReload) void navigate(target, { replace: sameStep });
  }, [target, current, navigate]);

  const attempt = async (work: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure);
    }
  };

  const goto = (step: number) => attempt(() => gotoMutation.mutateAsync(step));

  const api: DemoApi = {
    available,
    state,
    isLoading: available && query.isPending,
    loadError: available ? query.error : null,
    steps: state?.steps ?? [],
    step: state?.step ?? 1,
    total: state?.total ?? 25,
    current,
    context: state?.context,
    open,
    presentation: open && ui.presentation,
    collapsed: ui.collapsed,
    busy,
    activeJob: state?.activeJob ?? null,
    error,
    clearError: () => {
      setError(null);
    },
    canRun,
    canPromote,
    nextBlocked: nextBlockedReason(current),
    reviewerPersona,

    start: async (step) => {
      if (!available) return;
      setError(null);
      demoUi.open();
      if (step !== undefined && state && step !== state.step) await goto(step);
    },
    exit: () => {
      demoUi.close();
    },
    next: async () => {
      if (!state || !current || busy) return;
      if (current.n >= state.total) {
        demoUi.close();
        void navigate('/');
        return;
      }
      if (nextBlockedReason(current)) return;
      await attempt(async () => {
        // View steps have no button of their own: moving on is what completes them (idempotent).
        if (current.kind === 'view' && !current.done && canRun) {
          await performMutation.mutateAsync(current.n);
        }
        await gotoMutation.mutateAsync(current.n + 1);
      });
    },
    back: async () => {
      if (!state || busy || state.step <= 1) return;
      await goto(state.step - 1);
    },
    restart: async () => {
      if (!state || busy) return;
      await goto(1);
    },
    goto: async (step) => {
      if (busy) return;
      await goto(step);
    },
    performCurrent: async () => {
      if (!current || busy) return;
      await attempt(() => performMutation.mutateAsync(current.n));
    },
    seed: async (stage) => {
      if (available) await attempt(() => seedMutation.mutateAsync(stage));
    },
    reset: async () => {
      if (available) await attempt(() => resetMutation.mutateAsync());
    },
    switchToReviewer: async () => {
      const password = personas.data?.passwordHint;
      if (!reviewerPersona || !password) {
        setError(new Error('No reviewer identity is available to switch to.'));
        return;
      }
      await attempt(() => login.mutateAsync({ email: reviewerPersona.email, password }));
    },
    togglePresentation: () => {
      demoUi.setPresentation(!ui.presentation);
    },
    toggleCollapsed: () => {
      demoUi.setCollapsed(!ui.collapsed);
    },
  };

  /* ---- keyboard: ArrowRight / ArrowLeft / Esc / R while the presenter is open ---- */
  const latest = useRef(api);
  useEffect(() => {
    latest.current = api;
  });
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[aria-modal="true"], .bf-popover, .bf-tooltip, .bf-drawer'))
        return;
      const demo = latest.current;
      switch (event.key) {
        case 'ArrowRight':
          void demo.next();
          break;
        case 'ArrowLeft':
          void demo.back();
          break;
        case 'Escape':
          demo.exit();
          break;
        case 'r':
        case 'R':
          void demo.restart();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return api;
}

/** Mount once inside the authenticated shell. Everything about the guided demo hangs off `useDemo()`. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const api = useDemoController();
  return <DemoContext.Provider value={api}>{children}</DemoContext.Provider>;
}

/** The guided demo: state, navigation, performing steps (with `activeJob` progress), seeding and reset. */
export function useDemo(): DemoApi {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemo must be used inside <DemoProvider>');
  return context;
}

/** Like useDemo, but returns null outside the provider (pages rendered in tests or before sign-in). */
export function useOptionalDemo(): DemoApi | null {
  return useContext(DemoContext);
}

/**
 * Marks a page region as the focus of one or more demo steps. While the presenter is on one of those
 * steps the region gets `data-demo-active="true"` (an ember outline, see demo.css) and scrolls into view.
 *
 *   const target = useDemoTarget('firewall');
 *   <section {...target}> ... </section>
 *
 * Without the hook, a static `data-demo-target="firewall"` attribute marks the region but cannot highlight it.
 */
export function useDemoTarget(stepId: string | readonly string[]): {
  ref: (element: HTMLElement | null) => void;
  'data-demo-target': string;
  'data-demo-active'?: 'true';
} {
  const demo = useOptionalDemo();
  const element = useRef<HTMLElement | null>(null);
  const ids = typeof stepId === 'string' ? [stepId] : [...stepId];
  const active = Boolean(demo?.open && demo.current && ids.includes(demo.current.id));
  const ref = useCallback((node: HTMLElement | null) => {
    element.current = node;
  }, []);

  useEffect(() => {
    if (!active) return;
    const reduced = document.documentElement.getAttribute('data-motion') === 'reduced';
    element.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [active]);

  return {
    ref,
    'data-demo-target': ids.join(' '),
    ...(active ? { 'data-demo-active': 'true' as const } : {}),
  };
}
