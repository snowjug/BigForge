import { type ReactNode, useEffect } from 'react';
import { cx } from './cx';

/** Sets the document title ("Run Console · BigForge"). The shell announces the change to screen readers. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} \u00b7 BigForge`;
  }, [title]);
}

export interface PageProps {
  /** Document title. Usually the same text as the heading. */
  title: string;
  /** narrow: forms and reading. wide (default): capped at 1600px. full: edge to edge for split views. */
  width?: 'narrow' | 'wide' | 'full';
  className?: string;
  children: ReactNode;
}

/** The root of every page: sets the title and applies the canvas padding and max width. */
export function Page({ title, width = 'wide', className, children }: PageProps) {
  usePageTitle(title);
  return <div className={cx('bf-page', `bf-page--${width}`, className)}>{children}</div>;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** The question this page answers: the first thing a reader sees. */
  question?: ReactNode;
  /** Small label above the title, for example the Forge stage. */
  eyebrow?: ReactNode;
  /** Primary actions, right-aligned (wrap below on narrow screens). */
  actions?: ReactNode;
  /** Extra line below the question: counts, scope, last updated. */
  meta?: ReactNode;
}

/** Title, the question the page answers, and its actions. */
export function PageHeader({ title, question, eyebrow, actions, meta }: PageHeaderProps) {
  return (
    <header className="bf-page-head">
      <div className="bf-page-head__text">
        {eyebrow ? <p className="micro bf-page-head__eyebrow">{eyebrow}</p> : null}
        <h1 className="bf-page-head__title">{title}</h1>
        {question ? <p className="bf-page-head__question">{question}</p> : null}
        {meta ? <div className="bf-page-head__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="bf-page-head__actions">{actions}</div> : null}
    </header>
  );
}

/** A titled region inside a page: an `h2` with an optional description and actions. Not a card. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx('bf-section', className)}>
      <header className="bf-section__head">
        <div className="bf-section__titles">
          <h2 className="bf-section__title">{title}</h2>
          {description ? <p className="bf-section__desc">{description}</p> : null}
        </div>
        {actions ? <div className="bf-section__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
