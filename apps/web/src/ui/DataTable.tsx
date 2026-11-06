import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { cx } from './cx';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';
import type { Tone } from './tone';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  width?: number | string;
  align?: 'start' | 'end' | 'center';
  /** Monospace with tabular figures: ids, hashes, commands, numbers. */
  mono?: boolean;
  /** Hidden below 768px. Keep the identifying column and the decisive one. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  /** `undefined` is treated as "not loaded yet". */
  rows: readonly T[] | undefined;
  getRowId: (row: T) => string;
  /** Accessible name of the table. Rendered as a visually hidden caption. */
  caption: string;
  /** Marks the selected row (`aria-selected`). Selection itself is owned by the page. */
  selectedId?: string | null;
  /** Makes rows selectable by click, Enter and Space, with Arrow/Home/End/PageUp/PageDown roving focus. */
  onSelect?: (row: T) => void;
  loading?: boolean;
  /** Any thrown value. Shows an error row with Retry. */
  error?: unknown;
  onRetry?: () => void;
  /** Shown when `rows` is loaded and empty. Say what to do next. */
  empty?: ReactNode;
  skeletonRows?: number;
  /** Rows scroll inside the table so the header can stay sticky. */
  maxHeight?: number | string;
  dense?: boolean;
  /** Rendered under the table (for a "Load more" control or a count). */
  footer?: ReactNode;
  /** Highlights a row with a tone (for example crimson for a disagreement). Pair it with a text cue in a cell. */
  rowTone?: (row: T) => Tone | undefined;
  className?: string;
}

const PAGE_STEP = 5;

/**
 * A dense, keyboard-first data table with a sticky header and loading, empty and error states.
 * It is generic over the row type and never fetches: pass rows from a TanStack Query hook.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  selectedId,
  onSelect,
  loading = false,
  error,
  onRetry,
  empty,
  skeletonRows = 5,
  maxHeight = '70dvh',
  dense = false,
  footer,
  rowTone,
  className,
}: DataTableProps<T>) {
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const selectable = Boolean(onSelect);
  const list = rows ?? [];
  const failed = error !== undefined && error !== null && error !== false;
  const showSkeleton = (loading || rows === undefined) && !failed;
  const showEmpty = !showSkeleton && !failed && list.length === 0;
  const selectedIndex = selectedId ? list.findIndex((row) => getRowId(row) === selectedId) : -1;
  const tabbable = Math.min(
    focusIndex ?? (selectedIndex >= 0 ? selectedIndex : 0),
    list.length - 1,
  );

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(list.length - 1, index));
    setFocusIndex(next);
    rowRefs.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (!selectable || list.length === 0) return;
    const current = tabbable;
    switch (event.key) {
      case 'ArrowDown':
        moveTo(current + 1);
        break;
      case 'ArrowUp':
        moveTo(current - 1);
        break;
      case 'PageDown':
        moveTo(current + PAGE_STEP);
        break;
      case 'PageUp':
        moveTo(current - PAGE_STEP);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(list.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const row = list[current];
        if (row !== undefined) onSelect?.(row);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  const visibleColumns = columns;
  const span = visibleColumns.length;

  return (
    <div className={cx('bf-table-block', className)}>
      <div
        className="bf-table-wrap"
        style={{ maxHeight }}
        {...(selectable ? {} : { tabIndex: 0, role: 'region', 'aria-label': caption })}
      >
        <table
          className={cx('bf-table', dense && 'bf-table--dense')}
          aria-busy={showSkeleton || undefined}
        >
          <caption className="sr-only">
            {caption}
            {selectable ? '. Use the arrow keys to move between rows and Enter to select one.' : ''}
          </caption>
          <thead>
            <tr>
              {visibleColumns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cx(
                    column.align && `bf-table__cell--${column.align}`,
                    column.hideOnMobile && 'bf-table__cell--hide-mobile',
                  )}
                  style={column.width !== undefined ? { width: column.width } : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody onKeyDown={onKeyDown}>
            {showSkeleton
              ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} className="bf-table__skeleton-row">
                    {visibleColumns.map((column, columnIndex) => (
                      <td
                        key={column.id}
                        className={cx(column.hideOnMobile && 'bf-table__cell--hide-mobile')}
                      >
                        <Skeleton height={12} width={columnIndex === 0 ? '60%' : '80%'} />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {failed ? (
              <tr>
                <td colSpan={span} className="bf-table__state">
                  <ErrorState
                    compact
                    title="Could not load these rows"
                    error={error}
                    {...(onRetry ? { onRetry } : {})}
                  />
                </td>
              </tr>
            ) : null}
            {showEmpty ? (
              <tr>
                <td colSpan={span} className="bf-table__state">
                  {empty ?? <EmptyState compact title="Nothing to show yet" />}
                </td>
              </tr>
            ) : null}
            {!showSkeleton && !failed
              ? list.map((row, index) => {
                  const id = getRowId(row);
                  const tone = rowTone?.(row);
                  const selected = id === selectedId;
                  return (
                    <tr
                      key={id}
                      ref={(element) => {
                        if (element) rowRefs.current.set(index, element);
                        else rowRefs.current.delete(index);
                      }}
                      className={cx(
                        selectable && 'bf-table__row--selectable',
                        selected && 'bf-table__row--selected',
                      )}
                      {...(tone ? { 'data-tone': tone } : {})}
                      {...(selectable
                        ? {
                            tabIndex: index === tabbable ? 0 : -1,
                            'aria-selected': selected,
                            onFocus: () => {
                              setFocusIndex(index);
                            },
                            onClick: () => {
                              setFocusIndex(index);
                              onSelect?.(row);
                            },
                          }
                        : {})}
                    >
                      {visibleColumns.map((column) => (
                        <td
                          key={column.id}
                          className={cx(
                            column.align && `bf-table__cell--${column.align}`,
                            column.mono && 'mono num',
                            column.hideOnMobile && 'bf-table__cell--hide-mobile',
                          )}
                        >
                          {column.cell(row, index)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
      </div>
      {footer ? <div className="bf-table-foot">{footer}</div> : null}
    </div>
  );
}
