import { X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { cx } from './cx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * true (default): dims the page, traps focus and makes the page inert (an inspector that needs a decision).
   * false: docks beside the content without trapping focus (an inspector you browse with).
   */
  modal?: boolean;
  width?: number | string;
  className?: string;
}

/**
 * The right-hand inspector (a bottom sheet on phones). Focus moves in on open and returns to the opener
 * on close; Escape closes. Elements marked `data-autofocus` receive the initial focus instead of the panel.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  modal = true,
  width,
  className,
}: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  // Callers usually pass an inline handler; keep the latest one without re-running the focus effect.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    if (modal) root?.setAttribute('inert', '');
    const initial = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current;
    initial?.focus({ preventScroll: true });

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Let an open popover or tooltip inside the drawer take the first Escape.
      if (document.querySelector('.bf-popover, .bf-tooltip')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (modal) root?.removeAttribute('inert');
      // Back to where the user was; if that element is gone (a re-rendered row), land on the page.
      const target = opener?.isConnected ? opener : document.getElementById('main');
      target?.focus({ preventScroll: true });
    };
  }, [open, modal]);

  if (!open) return null;

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!modal || event.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === panel.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const content = (
    <div className={cx('bf-drawer-layer', modal && 'bf-drawer-layer--modal')}>
      {modal ? <div className="bf-drawer__scrim" aria-hidden="true" onClick={onClose} /> : null}
      <div
        ref={panel}
        role={modal ? 'dialog' : 'complementary'}
        {...(modal ? { 'aria-modal': true } : {})}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx('bf-drawer', className)}
        style={width !== undefined ? { width } : undefined}
        onKeyDown={trapTab}
      >
        <header className="bf-drawer__head">
          <div className="bf-drawer__titles">
            <h2 id={titleId} className="bf-drawer__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="bf-drawer__desc">
                {description}
              </p>
            ) : null}
          </div>
          <Button size="sm" aria-label="Close inspector" icon={<X size={16} />} onClick={onClose} />
        </header>
        <div className="bf-drawer__body">{children}</div>
        {footer ? <footer className="bf-drawer__foot">{footer}</footer> : null}
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
