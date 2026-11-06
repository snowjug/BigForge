import { type RefObject, useLayoutEffect, useRef } from 'react';
import { type Align, type Side, computePosition } from '../ui/positioning';

interface FloatingOptions {
  open: boolean;
  anchor: HTMLElement | null;
  side?: Side;
  align?: Align;
  offset?: number;
}

/**
 * Positions a `position: fixed` element next to its anchor and returns the ref to put on it. It writes
 * straight to the DOM (no React state) so the element never paints in the wrong place: it starts
 * `visibility: hidden` and is revealed here once placed.
 */
export function useFloating<T extends HTMLElement>({
  open,
  anchor,
  side,
  align,
  offset,
}: FloatingOptions): RefObject<T | null> {
  const floating = useRef<T | null>(null);

  useLayoutEffect(() => {
    const element = floating.current;
    if (!open || !anchor || !element) return undefined;

    const update = () => {
      const a = anchor.getBoundingClientRect();
      const f = element.getBoundingClientRect();
      const result = computePosition({
        anchor: { x: a.left, y: a.top, width: a.width, height: a.height },
        floating: { width: f.width, height: f.height },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        ...(side ? { side } : {}),
        ...(align ? { align } : {}),
        ...(offset !== undefined ? { offset } : {}),
      });
      element.style.transform = `translate(${Math.round(result.x)}px, ${Math.round(result.y)}px)`;
      element.dataset.side = result.side;
      element.style.visibility = 'visible';
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(anchor);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchor, side, align, offset]);

  return floating;
}
