import { X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '../../../api/client';
import { Button, type ButtonVariant } from '../../../ui';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  confirmIcon?: ReactNode;
  /** Disables the confirm button and explains why. */
  confirmDisabledReason?: string;
  /** The request is in flight: the dialog cannot be dismissed and Confirm shows progress. */
  busy?: boolean;
  /** A failed attempt: shown inside the dialog so the reason stays next to the retry. */
  error?: unknown;
  testId: string;
  confirmTestId: string;
}

/**
 * A modal confirmation for a consequential action. Focus moves into the dialog and is trapped; Escape and
 * the scrim cancel (except while the request is in flight); focus returns to the control that opened it.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  confirmIcon,
  confirmDisabledReason,
  busy = false,
  error,
  testId,
  confirmTestId,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    panel.current?.focus({ preventScroll: true });
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || busyRef.current) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      root?.removeAttribute('inert');
      const target = opener?.isConnected ? opener : document.getElementById('main');
      target?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panel.current) return;
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

  return createPortal(
    <div className="rfx-dialog-layer">
      <div
        className="rfx-dialog__scrim"
        aria-hidden="true"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={panel}
        className="rfx-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={trapTab}
      >
        <header className="rfx-dialog__head">
          <div>
            <h2 id={titleId} className="rfx-dialog__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="rfx-dialog__desc">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            size="sm"
            aria-label="Close dialog"
            icon={<X size={16} />}
            disabled={busy}
            onClick={onClose}
          />
        </header>
        <div className="rfx-dialog__body">{children}</div>
        {error !== undefined && error !== null ? (
          <p role="alert" className="rfx-dialog__error">
            {errorMessage(error)}
          </p>
        ) : null}
        <footer className="rfx-dialog__foot">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            icon={confirmIcon}
            loading={busy}
            data-testid={confirmTestId}
            disabled={Boolean(confirmDisabledReason)}
            {...(confirmDisabledReason ? { disabledReason: confirmDisabledReason } : {})}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
