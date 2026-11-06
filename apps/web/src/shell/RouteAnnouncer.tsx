import { useEffect, useRef } from 'react';

/**
 * A polite live region that reads out the page title whenever it changes (single-page navigation does
 * not reload the page, so screen readers would otherwise stay silent). Pages set the title with
 * usePageTitle; this observes <title> so it also works for lazily loaded pages.
 */
export function RouteAnnouncer() {
  const region = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const title = document.querySelector('title');
    if (!title) return undefined;
    const announce = () => {
      if (region.current) region.current.textContent = document.title;
    };
    const observer = new MutationObserver(announce);
    observer.observe(title, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={region} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
  );
}
