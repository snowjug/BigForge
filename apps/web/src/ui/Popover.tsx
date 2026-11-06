import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useFloating } from '../hooks/useFloating';
import { cx } from './cx';
import type { Align, Side } from './positioning';
import type { TriggerProps } from './Tooltip';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PopoverApi {
  close: () => void;
}

export interface PopoverProps {
  /** Rich content. A function receives `close` for items that should dismiss the popover. */
  content: ReactNode | ((api: PopoverApi) => ReactNode);
  /** The trigger button. It receives the toggle handler and ARIA state; it must not carry its own `ref`. */
  children: ReactElement<TriggerProps>;
  /** Accessible name of the popover. */
  label: string;
  side?: Side;
  align?: Align;
  /**
   * true (default): a dialog-like popover that takes focus and holds interactive content (menus, forms).
   * false: a "toggletip" that stays on the trigger and is announced politely (definitions).
   */
  interactive?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Click-toggled floating panel. Closes on Escape, outside press and (interactive) when focus leaves. */
export function Popover({
  content,
  children,
  label,
  side = 'bottom',
  align = 'start',
  interactive = true,
  className,
  open: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const floating = useFloating<HTMLDivElement>({ open, anchor, side, align });

  const setOpen = useCallback(
    (next: boolean) => {
      setInnerOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) anchor?.focus();
    },
    [setOpen, anchor],
  );

  useEffect(() => {
    if (!open || !interactive) return;
    const first = floating.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? floating.current)?.focus({ preventScroll: true });
  }, [open, interactive, floating]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPress = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor?.contains(target) || floating.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open, anchor, close, floating]);

  const own = children.props;
  const trigger = cloneElement(children, {
    ref: setAnchor,
    'aria-describedby': own['aria-describedby'],
    'aria-expanded': open,
    ...(interactive ? { 'aria-haspopup': 'dialog' as const } : {}),
    'aria-controls': open ? id : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => {
      own.onClick?.(event);
      setOpen(!open);
    },
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || event.key !== 'Tab' || !floating.current) return;
    const items = Array.from(floating.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    const leavingForward = !event.shiftKey && (items.length === 0 || event.target === last);
    const leavingBackward = event.shiftKey && (items.length === 0 || event.target === first);
    if (leavingForward || leavingBackward) close(true);
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const next = event.relatedTarget;
    if (next === null) return;
    if (next instanceof Node && (floating.current?.contains(next) || anchor?.contains(next)))
      return;
    close(false);
  };

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <div
              ref={floating}
              id={id}
              role={interactive ? 'dialog' : 'status'}
              aria-label={label}
              tabIndex={-1}
              className={cx('bf-popover', className)}
              style={{ visibility: 'hidden' }}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
            >
              {typeof content === 'function'
                ? content({
                    close: () => {
                      close(true);
                    },
                  })
                : content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
