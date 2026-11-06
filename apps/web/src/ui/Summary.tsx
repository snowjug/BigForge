import { Table2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SummaryColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end' | 'center';
  mono?: boolean;
}

export interface SummaryProps<T> {
  /** What the visualization shows, in one or two plain sentences. */
  description: ReactNode;
  columns: readonly SummaryColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  /** The disclosure label. */
  label?: string;
  /** Names the table for assistive technology. */
  caption?: string;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * The accessible text equivalent of a visualization: a `<details>` with a plain description and a data
 * table, reachable by keyboard. Every chart, graph, lane and sparkline-heavy view needs one beside it.
 */
export function Summary<T>({
  description,
  columns,
  rows,
  getRowId,
  label = 'View as table',
  caption,
  defaultOpen = false,
  className,
}: SummaryProps<T>) {
  return (
    <details className={cx('bf-summary', className)} {...(defaultOpen ? { open: true } : {})}>
      <summary className="bf-summary__toggle">
        <Table2 size={14} aria-hidden="true" />
        <span>{label}</span>
      </summary>
      <div className="bf-summary__body">
        <p className="bf-summary__desc">{description}</p>
        <div className="bf-table-wrap" tabIndex={0} role="region" aria-label={caption ?? label}>
          <table className="bf-table bf-table--dense">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    className={cx(column.align && `bf-table__cell--${column.align}`)}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={getRowId(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cx(
                        column.align && `bf-table__cell--${column.align}`,
                        column.mono && 'mono num',
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
