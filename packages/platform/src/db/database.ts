import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256Hex } from '@bigforge/security';
import { MIGRATIONS, type Migration } from './migrations';

export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationResult {
  applied: string[];
  current: number;
}

/** Applies pending migrations in order, each in its own transaction. Refuses edited history. */
export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
  const rows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as {
    version: number;
    name: string;
    checksum: string;
  }[];
  const applied: string[] = [];
  for (const m of migrations) {
    const checksum = sha256Hex(m.sql);
    const existing = rows.find((r) => r.version === m.version);
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new MigrationError(
          `Migration ${m.version} (${m.name}) was modified after it was applied`,
        );
      }
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(m.version, m.name, checksum, new Date().toISOString());
      db.exec('COMMIT');
      applied.push(`${m.version}:${m.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new MigrationError(
        `Migration ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
  const last = migrations[migrations.length - 1];
  return { applied, current: last?.version ?? 0 };
}

/** Runs `fn` in an immediate transaction; rolls back on any error. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
