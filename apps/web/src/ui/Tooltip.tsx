import {
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  cloneElement,
  useEffect,
  useId,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useFloating } from '../hooks/useFloating';
import type { Align, Side } from './positioning';

/** Props a trigger element receives. The trigger must not carry its own `ref`: it is replaced. */
export interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'dialog';
  'aria-controls'?: string;
}

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link, chip button). It receives the hover/focus handlers. */
  children: ReactElement<TriggerProps>;
  side?: Side;
  align?: Align;
  /** Hover delay in ms. Keyboard focus shows it immediately. */
  delay?: number;
  disabled?: boolean;
}

/**
 * Short, non-interactive help. Opens on mouse hover, keyboard focus, or a click/tap (which pins it
 * until Escape, blur or an outside press), so it also works on touch screens.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delay = 180,
  disabled = false,
}: TooltipProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);

  const hasContent =
    content !== null && content !== undefined && content !== false && content !== '';
  const open = !disabled && hasContent && (hovered || focused || pinned);
  const floating = useFloating<HTMLDivElement>({ open, anchor, side, align });

  // Hover intent: show after a short delay, hide the moment the pointer leaves.
  useEffect(() => {
    if (!pointerInside) return undefined;
    const timer = window.setTimeout(() => {
      setHovered(true);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      setHovered(false);
    };
  }, [pointerInside, delay]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPointerInside(false);
      setFocused(false);
      setPinned(false);
    };
    const onPress = (event: globalThis.PointerEvent) => {
      if (anchor && event.target instanceof Node && anchor.contains(event.target)) return;
      setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open, anchor]);

  const own = children.props;
  const trigger = cloneElement(children, {
    ref: setAnchor,
    'aria-describedby': open ? id : own['aria-describedby'],
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      own.onPointerEnter?.(event);
      if (event.pointerType !== 'touch') setPointerInside(true);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(event);
      setPointerInside(false);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      own.onFocus?.(event);
      if (event.currentTarget.matches(':focus-visible')) setFocused(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      own.onBlur?.(event);
      setFocused(false);
      setPinned(false);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      own.onClick?.(event);
      setPinned((value) => !value);
    },
  });

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <div
              ref={floating}
              id={id}
              role="tooltip"
              className="bf-tooltip"
              style={{ visibility: 'hidden' }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
