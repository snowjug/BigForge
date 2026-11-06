import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import type { Tone } from './tone';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  title: string;
  description?: ReactNode;
  tone?: ToastTone;
  /** Auto-dismiss delay. Danger toasts last longer; pass `Infinity` to keep it until dismissed. */
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  tone: ToastTone;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Record<ToastTone, { tone: Tone; icon: ReactNode }> = {
  info: { tone: 'steel', icon: <Info size={16} strokeWidth={2} /> },
  success: { tone: 'jade', icon: <CircleCheck size={16} strokeWidth={2} /> },
  warning: { tone: 'amber', icon: <TriangleAlert size={16} strokeWidth={2} /> },
  danger: { tone: 'crimson', icon: <CircleAlert size={16} strokeWidth={2} /> },
};

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const duration = item.durationMs ?? (item.tone === 'danger' ? 9000 : 5000);

  useEffect(() => {
    if (paused || !Number.isFinite(duration)) return undefined;
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, duration);
    return () => {
      window.clearTimeout(timer);
    };
  }, [paused, duration, item.id, onDismiss]);

  const { tone, icon } = TONE[item.tone];
  return (
    <div
      className="bf-toast"
      data-tone={tone}
      onPointerEnter={() => {
        setPaused(true);
      }}
      onPointerLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
    >
      <span className="bf-toast__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="bf-toast__text">
        <p className="bf-toast__title">{item.title}</p>
        {item.description ? <p className="bf-toast__desc">{item.description}</p> : null}
        {item.action ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              item.action?.onClick();
              onDismiss(item.id);
            }}
          >
            {item.action.label}
          </Button>
        ) : null}
      </div>
      <Button
        size="sm"
        aria-label="Dismiss notification"
        icon={<X size={14} />}
        onClick={() => {
          onDismiss(item.id);
        }}
      />
    </div>
  );
}

/** Mount once near the root. Toasts are announced politely (errors assertively) and never steal focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((current) => [...current.slice(-3), { ...options, id, tone: options.tone ?? 'info' }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="bf-toasts">
          <div className="bf-toasts__list" role="status" aria-live="polite">
            {items
              .filter((item) => item.tone !== 'danger' && item.tone !== 'warning')
              .map((item) => (
                <ToastView key={item.id} item={item} onDismiss={dismiss} />
              ))}
          </div>
          <div className="bf-toasts__list" role="alert" aria-live="assertive">
            {items
              .filter((item) => item.tone === 'danger' || item.tone === 'warning')
              .map((item) => (
                <ToastView key={item.id} item={item} onDismiss={dismiss} />
              ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** `const { toast } = useToast(); toast({ title: 'Settings saved', tone: 'success' })` */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
