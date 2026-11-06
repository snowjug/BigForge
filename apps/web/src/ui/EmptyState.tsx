import type { ReactNode } from 'react';
import { cx } from './cx';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Say what to do next, not just that nothing is here. */
  description?: ReactNode;
  action?: ReactNode;
  /** Inline variant for table cells and small panels. */
  compact?: boolean;
  className?: string;
}

/** Nothing here yet. Dashed strokes are the "raw, not yet forged" language. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx('bf-empty', compact && 'bf-empty--compact', className)}>
      {icon ? (
        <span className="bf-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="bf-empty__text">
        <p className="bf-empty__title">{title}</p>
        {description ? <p className="bf-empty__desc">{description}</p> : null}
      </div>
      {action ? <div className="bf-empty__action">{action}</div> : null}
    </div>
  );
}
