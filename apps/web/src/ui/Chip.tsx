import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import type { Tone } from './tone';

export interface ChipProps extends ComponentProps<'span'> {
  tone?: Tone;
  /** soft: tinted fill (default). outline: hairline only. solid: filled, for the one thing that matters. */
  variant?: 'soft' | 'outline' | 'solid';
  icon?: ReactNode;
  /** Dashed outline: raw, simulated or pending (never solid until approved). */
  dashed?: boolean;
  mono?: boolean;
  size?: 'sm' | 'md';
}

/** A compact label for status, role, kind or provenance. Colour is always paired with text or an icon. */
export function Chip({
  tone = 'neutral',
  variant = 'soft',
  icon,
  dashed = false,
  mono = false,
  size = 'md',
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span
      data-tone={tone}
      className={cx(
        'bf-chip',
        `bf-chip--${variant}`,
        `bf-chip--${size}`,
        dashed && 'bf-chip--dashed',
        mono && 'mono',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span className="bf-chip__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
