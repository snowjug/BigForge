import type { ComponentProps } from 'react';
import { cx } from './cx';

/** A keyboard key cap. */
export function Kbd({ className, children, ...rest }: ComponentProps<'kbd'>) {
  return (
    <kbd className={cx('bf-kbd', className)} {...rest}>
      {children}
    </kbd>
  );
}
