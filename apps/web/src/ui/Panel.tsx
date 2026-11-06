import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned header controls. */
  actions?: ReactNode;
  /** dense: tighter padding. flush: no padding, for tables and lists that bring their own. */
  variant?: 'default' | 'dense' | 'flush';
  /** The element rendered. Use `aside` for inspectors. */
  as?: 'section' | 'div' | 'aside' | 'article';
  headingLevel?: 2 | 3 | 4;
  footer?: ReactNode;
  className?: string;
  id?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

/** A bordered surface step: elevation is a surface colour plus a hairline, never a shadow. */
export function Panel({
  title,
  subtitle,
  actions,
  variant = 'default',
  as: Tag = 'section',
  headingLevel = 2,
  footer,
  className,
  id,
  'aria-label': ariaLabel,
  children,
}: PanelProps) {
  const Heading = `h${headingLevel}` as const;
  const hasHead = Boolean(title || actions || subtitle);
  return (
    <Tag
      id={id}
      aria-label={ariaLabel}
      className={cx('bf-panel', `bf-panel--${variant}`, className)}
    >
      {hasHead ? (
        <header className="bf-panel__head">
          <div className="bf-panel__titles">
            {title ? <Heading className="bf-panel__title">{title}</Heading> : null}
            {subtitle ? <p className="bf-panel__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="bf-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="bf-panel__body">{children}</div>
      {footer ? <footer className="bf-panel__foot">{footer}</footer> : null}
    </Tag>
  );
}
