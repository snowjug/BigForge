import { OctagonAlert, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { Button } from './Button';
import { cx } from './cx';

interface ErrorStateProps {
  title?: ReactNode;
  /** Any thrown value; ApiError adds its HTTP status, code and details. */
  error?: unknown;
  /** Shows a Retry button. Pass the query's `refetch`. */
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/** Something failed. Crimson, never alarming by size, always with a way to try again. */
export function ErrorState({
  title = 'This could not be loaded',
  error,
  onRetry,
  retrying = false,
  compact,
  className,
}: ErrorStateProps) {
  const api = error instanceof ApiError ? error : null;
  const hasDetails = api?.details !== undefined && api.details !== null;
  return (
    <div role="alert" className={cx('bf-error', compact && 'bf-error--compact', className)}>
      <span className="bf-error__icon" aria-hidden="true">
        <OctagonAlert size={compact ? 16 : 20} strokeWidth={1.75} />
      </span>
      <div className="bf-error__text">
        <p className="bf-error__title">{title}</p>
        {error !== undefined ? <p className="bf-error__msg">{errorMessage(error)}</p> : null}
        {api ? (
          <p className="bf-error__code mono">
            {api.status > 0 ? `${api.status} ` : ''}
            {api.code}
          </p>
        ) : null}
        {hasDetails ? (
          <details className="bf-error__details">
            <summary>Details</summary>
            <pre>{JSON.stringify(api?.details, null, 2)}</pre>
          </details>
        ) : null}
      </div>
      {onRetry ? (
        <Button
          size="sm"
          icon={<RotateCw size={14} />}
          loading={retrying}
          onClick={onRetry}
          className="bf-error__retry"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
