import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * Width of an element, kept current with a ResizeObserver. Returns `[ref, width]` where `ref` is a
 * callback ref and `width` is null until the element is measured (and on the server).
 */
export function useElementWidth(): [(element: HTMLElement | null) => void, number | null] {
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
