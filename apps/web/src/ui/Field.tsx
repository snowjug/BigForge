import { CircleAlert } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { cx } from './cx';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  /** A validation message. Announced politely when it appears and linked to the control. */
  error?: ReactNode;
  className?: string;
  /** Render the control with the id and ARIA wiring: `{(c) => <input className="bf-input" {...c} />}`. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label + control + help + error, wired together for assistive technology. */
export function Field({ label, help, error, className, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cx('bf-field', className)}>
      <label className="bf-label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {help ? (
        <p id={helpId} className="bf-help">
          {help}
        </p>
      ) : null}
      <div aria-live="polite">
        {error ? (
          <p id={errorId} className="bf-field-error">
            <CircleAlert size={14} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface SwitchProps extends Omit<ComponentProps<'input'>, 'type' | 'role' | 'children'> {
  label: ReactNode;
}

/** An on/off setting. Native checkbox semantics with `role="switch"`. */
export function Switch({ label, className, ...rest }: SwitchProps) {
  return (
    <label className={cx('bf-switch', className)}>
      <input type="checkbox" role="switch" {...rest} />
      <span>{label}</span>
    </label>
  );
}
