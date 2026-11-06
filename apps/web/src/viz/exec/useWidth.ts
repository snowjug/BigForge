import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * Width of an element in whole pixels, kept current with a ResizeObserver. `[ref, width]`: `width` is
 * null until the element has been measured. The SVG visualizations lay themselves out at this width so
 * one drawing unit is one pixel and their text never shrinks below its designed size.
 */
export function useWidth(): [(element: HTMLElement | null) => void, number | null] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!element || typeof ResizeObserver === 'undefined') return () => undefined;
      const observer = new ResizeObserver(notify);
      observer.observe(element);
      return () => {
        observer.disconnect();
      };
    },
    [element],
  );
  const read = useCallback(() => (element ? Math.floor(element.clientWidth) : -1), [element]);
  const width = useSyncExternalStore(subscribe, read, () => -1);
  return [setElement, width > 0 ? width : null];
}
