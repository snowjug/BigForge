import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cx } from './cx';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** A small count rendered after the label. */
  count?: number | string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  /** Accessible name of the tab list. */
  label: string;
  items: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** Must match the `idPrefix` of the TabPanels, which is how tab and panel are linked for assistive tech. */
  idPrefix: string;
  className?: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * Accessible tabs with automatic activation: ArrowLeft/ArrowRight (and Home/End) move and select,
 * with a roving tabindex so the whole list is one tab stop.
 */
export function Tabs({ label, items, value, onValueChange, idPrefix, className }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((item) => item.id === value);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % enabled.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onValueChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cx('bf-tabs', className)}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(element) => {
              if (element) refs.current.set(item.id, element);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className="bf-tab"
            onClick={() => {
              onValueChange(item.id);
            }}
          >
            {item.icon ? (
              <span className="bf-tab__icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
            {item.count !== undefined ? (
              <span className="bf-tab__count num">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idPrefix: string;
  /** The tab this panel belongs to. */
  id: string;
  /** The currently selected tab id. Inactive panels render nothing. */
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ idPrefix, id, value, children, className }: TabPanelProps) {
  if (id !== value) return null;
  return (
    <div
      role="tabpanel"
      id={panelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      tabIndex={0}
      className={cx('bf-tabpanel', className)}
    >
      {children}
    </div>
  );
}
