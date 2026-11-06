import { cx } from './cx';

interface ForgeLogoProps {
  size?: number;
  /** Renders the "BigForge" wordmark beside the mark. */
  wordmark?: boolean;
  /** Accessible name. The mark is decorative (aria-hidden) when a wordmark or adjacent text names it. */
  title?: string;
  className?: string;
}

/**
 * The BigForge mark: an anvil (steel, the forged pathway) with a hardy-hole notch and two sparks
 * (molten and ember: the heat that is spent once). Original artwork drawn for this product.
 */
export function ForgeLogo({ size = 28, wordmark = false, title, className }: ForgeLogoProps) {
  const svg = (
    <svg
      className="bf-logo__mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      {...(title && !wordmark ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      focusable="false"
    >
      <path
        className="bf-logo__body"
        d="M3 14.2Q8 14.2 10.6 11.8H21.4V13.4H24.2V11.8H28.2V15.6L23 16.7V21L26.6 23.2V27.2H8.4V23.2L12 21V17Q7 16.4 3 14.2Z"
      />
      <path className="bf-logo__face" d="M10.6 11.8H21.4V12.9H11.6ZM24.2 11.8H28.2V12.9H24.2Z" />
      <path className="bf-logo__waist" d="M12 21V17L23 16.7V21Z" />
      <path
        className="bf-logo__spark"
        d="M20 1.8 21.2 4.9 24.4 6 21.2 7.1 20 10.2 18.8 7.1 15.6 6 18.8 4.9Z"
      />
      <path
        className="bf-logo__ember"
        d="M25.6 3 26.2 4.4 27.6 5 26.2 5.6 25.6 7 25 5.6 23.6 5 25 4.4Z"
      />
    </svg>
  );
  if (!wordmark) return <span className={cx('bf-logo', className)}>{svg}</span>;
  return (
    <span className={cx('bf-logo', className)}>
      {svg}
      <span className="bf-logo__word">BigForge</span>
    </span>
  );
}
