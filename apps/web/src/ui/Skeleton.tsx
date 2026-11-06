import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

/** A placeholder block. Decorative: pair a group with <SkeletonGroup label> so the busy state is announced. */
export function Skeleton({ width, height = 14, radius, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <span className={cx('bf-skeleton', className)} style={style} aria-hidden="true" />;
}

/** Lines of text-shaped placeholders; the last line is shorter. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx('bf-skeleton-lines', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          height={12}
          width={index === lines - 1 && lines > 1 ? '62%' : '100%'}
        />
      ))}
    </span>
  );
}

/** Wraps skeletons in a polite busy region with an accessible label. */
export function SkeletonGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}
