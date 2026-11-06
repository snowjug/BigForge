import { cx } from './cx';

interface SpinnerProps {
  size?: number;
  /** Announces the busy state. Omit when a visible label is already adjacent. */
  label?: string;
  className?: string;
}

/**
 * A ring spinner. Under reduced motion the rotation stops and the ring stays as a static
 * "working" glyph, so state is never conveyed by animation alone.
 */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <svg
      className={cx('bf-spinner', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <circle className="bf-spinner__track" cx="12" cy="12" r="9" strokeWidth="2.5" />
      <path
        className="bf-spinner__arc"
        d="M12 3a9 9 0 0 1 9 9"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
