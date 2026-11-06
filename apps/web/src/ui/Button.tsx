import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from './cx';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'forge';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  /**
   * primary: the one high-contrast action. forge: ember, for the signature "make heat" actions.
   * ghost: quiet, bordered. danger: destructive.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Stretch to the container width. */
  block?: boolean;
}

export interface ButtonProps extends CommonProps, Omit<ComponentProps<'button'>, 'disabled'> {
  loading?: boolean;
  disabled?: boolean;
  /**
   * Why the button is unavailable. The button stays focusable (aria-disabled) and explains itself in a
   * tooltip, which is how every disabled action should behave.
   */
  disabledReason?: string;
}

function buttonClass(
  { variant = 'ghost', size = 'md', block }: CommonProps,
  className: string | undefined,
  iconOnly: boolean,
): string {
  return cx(
    'bf-btn',
    `bf-btn--${variant}`,
    `bf-btn--${size}`,
    block && 'bf-btn--block',
    iconOnly && 'bf-btn--icon',
    className,
  );
}

export function Button({
  variant,
  size,
  block,
  icon,
  iconRight,
  loading = false,
  disabled = false,
  disabledReason,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const unavailable = disabled || loading;
  // A disabled button with a reason must stay focusable so keyboard users can read the reason.
  const nativeDisabled = disabled && !disabledReason;
  const iconOnly = !children;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const button = (
    <button
      type={type}
      className={buttonClass({ variant, size, block }, className, iconOnly)}
      disabled={nativeDisabled}
      aria-disabled={unavailable && !nativeDisabled ? true : undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      {children ? <span className="bf-btn__label">{children}</span> : null}
      {iconRight}
    </button>
  );
  return disabled && disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button;
}

export interface ButtonLinkProps extends CommonProps, LinkProps {}

/** A router link that looks like a Button. Navigation is a link, never a button. */
export function ButtonLink({
  variant,
  size,
  block,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, block }, className, false)} {...rest}>
      {icon}
      <span className="bf-btn__label">{children}</span>
      {iconRight}
    </Link>
  );
}
