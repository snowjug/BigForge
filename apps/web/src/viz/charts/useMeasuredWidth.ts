import { useEffect, useState } from 'react';

/**
 * Width of an element, kept current with a ResizeObserver. Attach `ref` to the container; `width` is 0
 * until the first measurement (render a placeholder or a sensible default meanwhile).
 */
export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>(): {
  ref: (element: T | null) => void;
  width: number;
} {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return { ref: setElement, width };
}
