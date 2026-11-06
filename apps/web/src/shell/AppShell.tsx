import { Suspense, useEffect, useRef, type CSSProperties } from 'react';
import { Outlet, useLocation } from 'react-router';
import { PresenterBar } from '../demo/PresenterBar';
import { DemoProvider } from '../demo/useDemo';
import { useDemo } from '../demo/useDemo';
import { Skeleton, SkeletonGroup } from '../ui';
import { ForgeStrip } from './ForgeStrip';
import { Rail } from './Rail';
import { RouteAnnouncer } from './RouteAnnouncer';
import { TabBar } from './TabBar';

export function PageFallback() {
  return (
    <SkeletonGroup label="Loading the page" className="bf-page bf-page--wide">
      <div className="stack" style={{ '--gap': '20px' } as CSSProperties}>
        <Skeleton width={180} height={12} />
        <Skeleton width={320} height={32} />
        <Skeleton width={420} height={14} />
        <Skeleton height={240} radius={8} />
      </div>
    </SkeletonGroup>
  );
}

function Frame() {
  const demo = useDemo();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement | null>(null);
  const firstPath = useRef(pathname);

  // New page: return to the top and move focus to <main>, so keyboard and screen-reader users start
  // from the new content instead of the link they just activated.
  useEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    main.current?.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="bf-shell" data-presenting={demo.open ? 'true' : undefined}>
      <a className="bf-skip" href="#main">
        Skip to main content
      </a>
      <Rail />
      <ForgeStrip />
      <main id="main" ref={main} tabIndex={-1} className="bf-main">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <PresenterBar />
      <TabBar />
      <RouteAnnouncer />
    </div>
  );
}

/** The authenticated application frame: rail, Forge strip, canvas, presenter bar and (mobile) tab bar. */
export function AppShell() {
  return (
    <DemoProvider>
      <Frame />
    </DemoProvider>
  );
}
