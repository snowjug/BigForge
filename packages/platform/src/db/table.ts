import type { SQLInputValue } from 'node:sqlite';
import type { Db } from './database';

const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (s: string): string => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const IDENT = /^[a-z_][a-z0-9_]*$/;

export interface TableDef {
  name: string;
  /** Fields stored as JSON text in `<snake_case>_json` columns. */
  json: readonly string[];
  /** Fields stored as 0/1 integers. */
  bool?: readonly string[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface ListOptions {
  where?: Record<string, string | number | boolean | null>;
  /** Internal ordering only; validated against a strict identifier pattern. */
  order?: string;
  limit?: number;
  cursor?: string;
  /** Restrict to these fields (JSON fields not listed are not decoded). */
  fields?: readonly string[];
}

export const MAX_LIMIT = 100;

/**
 * Tenant-scoped table access. EVERY statement is filtered by tenant_id, so a query cannot
 * reach another tenant's rows. Identifiers are validated; values are always parameters.
 */
export class Table<T extends { id: string }> {
  private readonly db: Db;
  readonly def: TableDef;

  constructor(db: Db, def: TableDef) {
    this.db = db;
    this.def = def;
  }

  private column(field: string): string {
    const base = snake(field);
    if (!IDENT.test(base)) throw new Error(`Invalid column: ${field}`);
    return this.def.json.includes(field) ? `${base}_json` : base;
  }

  private encode(value: unknown, field: string): SQLInputValue {
    if (this.def.json.includes(field)) return JSON.stringify(value ?? null);
    if (this.def.bool?.includes(field)) return value ? 1 : 0;
    if (value === undefined) return null;
    return value as SQLInputValue;
  }

  private decode(row: Record<string, unknown>, fields?: readonly string[]): T {
    const out: Record<string, unknown> = {};
    for (const [col, raw] of Object.entries(row)) {
      const isJson = col.endsWith('_json');
      const field = camel(isJson ? col.slice(0, -5) : col);
      if (fields && !fields.includes(field)) continue;
      if (isJson) out[field] = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : null;
      else if (this.def.bool?.includes(field)) out[field] = raw === 1;
      else out[field] = raw;
    }
    return out as T;
  }

  private selectList(fields?: readonly string[]): string {
    if (!fields) return '*';
    return fields.map((f) => this.column(f)).join(', ');
  }

  insert(tenantId: string, row: Omit<T, 'tenantId'>): void {
    const entries = Object.entries(row as Record<string, unknown>);
    const cols = ['tenant_id', ...entries.map(([k]) => this.column(k))];
    const vals: SQLInputValue[] = [tenantId, ...entries.map(([k, v]) => this.encode(v, k))];
    this.db
      .prepare(
        `INSERT INTO ${this.def.name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      .run(...vals);
  }

  get(tenantId: string, id: string, fields?: readonly string[]): T | null {
    const row = this.db
      .prepare(
        `SELECT ${this.selectList(fields)} FROM ${this.def.name} WHERE tenant_id = ? AND id = ?`,
      )
      .get(tenantId, id) as Record<string, unknown> | undefined;
    return row ? this.decode(row, fields) : null;
  }

  update(tenantId: string, id: string, patch: Partial<Omit<T, 'id' | 'tenantId'>>): void {
    const entries = Object.entries(patch as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${this.column(k)} = ?`).join(', ');
    const vals: SQLInputValue[] = entries.map(([k, v]) => this.encode(v, k));
    const res = this.db
      .prepare(`UPDATE ${this.def.name} SET ${sets} WHERE tenant_id = ? AND id = ?`)
      .run(...vals, tenantId, id);
    if (Number(res.changes) === 0)
      throw new Error(`${this.def.name} ${id} not found for this tenant`);
  }

  private whereClause(
    tenantId: string,
    where?: ListOptions['where'],
  ): { sql: string; params: SQLInputValue[] } {
    const parts = ['tenant_id = ?'];
    const params: SQLInputValue[] = [tenantId];
    for (const [k, v] of Object.entries(where ?? {})) {
      const col = this.column(k);
      if (v === null) parts.push(`${col} IS NULL`);
      else {
        parts.push(`${col} = ?`);
        params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
    }
    return { sql: parts.join(' AND '), params };
  }

  count(tenantId: string, where?: ListOptions['where']): number {
    const w = this.whereClause(tenantId, where);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${this.def.name} WHERE ${w.sql}`)
      .get(...w.params) as { n: number };
    return row.n;
  }

  list(tenantId: string, opts: ListOptions = {}): Page<T> {
    const limit = Math.min(Math.max(1, opts.limit ?? 25), MAX_LIMIT);
    const offset = Math.max(0, Number.parseInt(opts.cursor ?? '0', 10) || 0);
    const order = opts.order ?? 'created_at DESC, id DESC';
    if (!/^[a-z_]+( (ASC|DESC))?(, [a-z_]+( (ASC|DESC))?)*$/i.test(order))
      throw new Error('Invalid order');
    const w = this.whereClause(tenantId, opts.where);
    const rows = this.db
      .prepare(
        `SELECT ${this.selectList(opts.fields)} FROM ${this.def.name} WHERE ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...w.params, limit + 1, offset) as Record<string, unknown>[];
    const items = rows.slice(0, limit).map((r) => this.decode(r, opts.fields));
    const total = this.count(tenantId, opts.where);
    return { items, nextCursor: rows.length > limit ? String(offset + limit) : null, total };
  }

  /** All rows (bounded) for internal aggregation. */
  all(tenantId: string, opts: Omit<ListOptions, 'cursor'> & { max?: number } = {}): T[] {
    const out: T[] = [];
    let cursor: string | undefined;
    const max = opts.max ?? 2000;
    do {
      const page = this.list(tenantId, {
        ...opts,
        limit: MAX_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      out.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && out.length < max);
    return out;
  }
}
