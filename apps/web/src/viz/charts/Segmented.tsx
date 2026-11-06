import { type KeyboardEvent, useRef } from 'react';
import './charts.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/** A small exclusive choice (a radio group drawn as segments): arrows move and select, Tab leaves the group. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled);

  const move = (event: KeyboardEvent<HTMLButtonElement>, from: T) => {
    const at = enabled.findIndex((option) => option.value === from);
    let next: SegmentedOption<T> | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = enabled[(at + 1) % enabled.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    buttons.current.get(next.value)?.focus();
  };

  return (
    <div
      className={`bf-seg${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element) buttons.current.set(option.value, element);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            title={option.title}
            className="bf-seg__item"
            onClick={() => {
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              move(event, option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
