import type { SQLInputValue } from 'node:sqlite';
import { GENESIS_HASH, chainHash } from '@bigforge/security';
import type {
  Comparison,
  CompileReport,
  DriftDetail,
  DriftVerdict,
  ExecSummary,
  FamilyMatch,
  FamilyMember,
  FileChange,
  Fingerprint,
  MutationDiff,
  MutationEvidence,
  ReflexSpec,
  ReflexStatus,
  Role,
  RunKind,
  TaskStatus,
  Trace,
  TrustWindow,
  UsageSummary,
} from '@bigforge/schemas';
import type { Db } from './database';
import { transaction } from './database';
import { MAX_LIMIT, type Page, Table } from './table';

export interface TaskRow {
  id: string;
  tenantId: string;
  scenarioId: string;
  variantKey: string;
  scenarioRole: string;
  title: string;
  prompt: string;
  envVersion: string;
  status: TaskStatus;
  origin: 'intake' | 'noise' | 'canary' | 'reference';
  fingerprint: Fingerprint;
  match: FamilyMatch | null;
  familyId: string | null;
  originalLog: string | null;
  createdAt: string;
}

export interface RunRow {
  id: string;
  tenantId: string;
  taskId: string;
  kind: RunKind;
  status: string;
  reflexVersionId: string | null;
  groupId: string | null;
  trace: Trace;
  changes: FileChange[];
  exec: ExecSummary | null;
  usage: UsageSummary;
  totalTokens: number;
  costUsd: number;
  modelCalls: number;
  createdAt: string;
}

export interface FamilyRow {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  centroid: Fingerprint;
  members: FamilyMember[];
  variants: string[];
  createdAt: string;
}

export interface ReflexRow {
  id: string;
  tenantId: string;
  name: string;
  familyId: string;
  createdAt: string;
}

export interface ReflexVersionRow {
  id: string;
  tenantId: string;
  reflexId: string;
  version: string;
  status: ReflexStatus;
  spec: ReflexSpec;
  contentHash: string;
  compileReport: CompileReport;
  confidence: number;
  trust: TrustWindow;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionRow {
  id: string;
  tenantId: string;
  reflexVersionId: string;
  fromStatus: ReflexStatus;
  toStatus: ReflexStatus;
  event: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface ComparisonRow {
  id: string;
  tenantId: string;
  kind: 'replay' | 'shadow' | 'canary' | 'live';
  reflexVersionId: string;
  taskId: string;
  baselineRunId: string | null;
  reflexRunId: string;
  variantKey: string;
  agree: boolean;
  comparison: Comparison;
  createdAt: string;
}

export interface ApprovalRow {
  id: string;
  tenantId: string;
  reflexVersionId: string;
  action: string;
  actorUserId: string;
  actorName: string;
  comment: string;
  evidence: unknown;
  createdAt: string;
}

export interface MutationRow {
  id: string;
  tenantId: string;
  reflexId: string;
  fromVersionId: string;
  toVersionId: string;
  status: 'proposed' | 'approved' | 'rejected';
  reason: string;
  diff: MutationDiff;
  evidence: MutationEvidence;
  createdAt: string;
  decidedAt: string | null;
}

export interface DriftCheckRow {
  id: string;
  tenantId: string;
  reflexVersionId: string;
  envVersion: string;
  verdict: DriftVerdict;
  detail: DriftDetail;
  createdAt: string;
}

export interface LedgerRow {
  id: string;
  tenantId: string;
  category: string;
  label: string;
  runId: string | null;
  taskId: string | null;
  reflexVersionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  modelCalls: number;
  costUsd: number;
  tokenProvenance: string;
  createdAt: string;
}

export interface JobRow {
  id: string;
  tenantId: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  params: Record<string, unknown>;
  progress: { done: number; total: number; label: string };
  result: unknown;
  error: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface AuditRow {
  seq: number;
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  details: unknown;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface AuditInput {
  id: string;
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  details: unknown;
  createdAt: string;
}

export interface DemoStateRow {
  step: number;
  completed: number[];
  context: Record<string, unknown>;
}

/** Process-wide (non tenant-scoped) access: tenants and user lookup for login. */
export class Store {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insertTenant(t: TenantRow): void {
    this.db
      .prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)')
      .run(t.id, t.slug, t.name, t.createdAt);
  }

  getTenant(id: string): TenantRow | null {
    const r = this.db
      .prepare('SELECT id, slug, name, created_at AS createdAt FROM tenants WHERE id = ?')
      .get(id) as TenantRow | undefined;
    return r ?? null;
  }

  listTenants(): TenantRow[] {
    return this.db
      .prepare('SELECT id, slug, name, created_at AS createdAt FROM tenants ORDER BY slug')
      .all() as unknown as TenantRow[];
  }

  insertUser(u: UserRow): void {
    this.db
      .prepare(
        'INSERT INTO users (id, tenant_id, email, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(u.id, u.tenantId, u.email, u.displayName, u.role, u.passwordHash, u.createdAt);
  }

  findUserByEmail(email: string): UserRow | null {
    const r = this.db
      .prepare(
        'SELECT id, tenant_id AS tenantId, email, display_name AS displayName, role, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?',
      )
      .get(email.toLowerCase()) as UserRow | undefined;
    return r ?? null;
  }

  getUser(id: string): UserRow | null {
    const r = this.db
      .prepare(
        'SELECT id, tenant_id AS tenantId, email, display_name AS displayName, role, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ?',
      )
      .get(id) as UserRow | undefined;
    return r ?? null;
  }

  listUsers(): UserRow[] {
    return this.db
      .prepare(
        'SELECT id, tenant_id AS tenantId, email, display_name AS displayName, role, password_hash AS passwordHash, created_at AS createdAt FROM users ORDER BY tenant_id, role, email',
      )
      .all() as unknown as UserRow[];
  }

  forTenant(tenantId: string): TenantStore {
    return new TenantStore(this.db, tenantId);
  }

  /** Oldest queued job across all tenants (used by the job runner). */
  claimNextJob(): { id: string; tenantId: string } | null {
    return transaction(this.db, () => {
      const row = this.db
        .prepare(
          "SELECT id, tenant_id AS tenantId FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1",
        )
        .get() as { id: string; tenantId: string } | undefined;
      if (!row) return null;
      this.db
        .prepare(
          "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(new Date().toISOString(), row.id);
      return row;
    });
  }
}

/** Every method is scoped to one tenant: no query in this class can read another tenant's data. */
export class TenantStore {
  readonly tenantId: string;
  private readonly db: Db;
  readonly tasks: Table<TaskRow>;
  readonly runs: Table<RunRow>;
  readonly families: Table<FamilyRow>;
  readonly reflexes: Table<ReflexRow>;
  readonly versions: Table<ReflexVersionRow>;
  readonly transitions: Table<TransitionRow>;
  readonly comparisons: Table<ComparisonRow>;
  readonly approvals: Table<ApprovalRow>;
  readonly mutations: Table<MutationRow>;
  readonly driftChecks: Table<DriftCheckRow>;
  readonly ledger: Table<LedgerRow>;
  readonly jobs: Table<JobRow>;

  constructor(db: Db, tenantId: string) {
    this.db = db;
    this.tenantId = tenantId;
    this.tasks = new Table<TaskRow>(db, { name: 'tasks', json: ['fingerprint', 'match'] });
    this.runs = new Table<RunRow>(db, {
      name: 'runs',
      json: ['trace', 'changes', 'exec', 'usage'],
    });
    this.families = new Table<FamilyRow>(db, {
      name: 'families',
      json: ['centroid', 'members', 'variants'],
    });
    this.reflexes = new Table<ReflexRow>(db, { name: 'reflexes', json: [] });
    this.versions = new Table<ReflexVersionRow>(db, {
      name: 'reflex_versions',
      json: ['spec', 'compileReport', 'trust'],
    });
    this.transitions = new Table<TransitionRow>(db, { name: 'reflex_transitions', json: [] });
    this.comparisons = new Table<ComparisonRow>(db, {
      name: 'comparisons',
      json: ['comparison'],
      bool: ['agree'],
    });
    this.approvals = new Table<ApprovalRow>(db, { name: 'approvals', json: ['evidence'] });
    this.mutations = new Table<MutationRow>(db, { name: 'mutations', json: ['diff', 'evidence'] });
    this.driftChecks = new Table<DriftCheckRow>(db, {
      name: 'drift_checks',
      json: ['verdict', 'detail'],
    });
    this.ledger = new Table<LedgerRow>(db, { name: 'ledger', json: [] });
    this.jobs = new Table<JobRow>(db, { name: 'jobs', json: ['params', 'progress', 'result'] });
  }

  /** Finds a run by the id of the trace it recorded. */
  findRunByTraceId(traceId: string): RunRow | null {
    const row = this.db
      .prepare("SELECT id FROM runs WHERE tenant_id = ? AND json_extract(trace_json, '$.id') = ?")
      .get(this.tenantId, traceId) as { id: string } | undefined;
    return row ? this.runs.get(this.tenantId, row.id) : null;
  }

  // ---- settings ----
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare('SELECT value_json AS v FROM settings WHERE tenant_id = ? AND key = ?')
      .get(this.tenantId, key) as { v: string } | undefined;
    return row ? (JSON.parse(row.v) as T) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (tenant_id, key, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      )
      .run(this.tenantId, key, JSON.stringify(value), new Date().toISOString());
  }

  // ---- demo state ----
  getDemoState(): DemoStateRow | null {
    const row = this.db
      .prepare(
        'SELECT step, completed_json AS c, context_json AS x FROM demo_state WHERE tenant_id = ?',
      )
      .get(this.tenantId) as { step: number; c: string; x: string } | undefined;
    return row
      ? {
          step: row.step,
          completed: JSON.parse(row.c) as number[],
          context: JSON.parse(row.x) as Record<string, unknown>,
        }
      : null;
  }

  saveDemoState(state: DemoStateRow): void {
    this.db
      .prepare(
        'INSERT INTO demo_state (tenant_id, step, completed_json, context_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id) DO UPDATE SET step = excluded.step, completed_json = excluded.completed_json, context_json = excluded.context_json, updated_at = excluded.updated_at',
      )
      .run(
        this.tenantId,
        state.step,
        JSON.stringify(state.completed),
        JSON.stringify(state.context),
        new Date().toISOString(),
      );
  }

  // ---- audit (append-only, hash-chained per tenant) ----
  appendAudit(input: AuditInput): AuditRow {
    return transaction(this.db, () => {
      const last = this.db
        .prepare('SELECT hash FROM audit_events WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1')
        .get(this.tenantId) as { hash: string } | undefined;
      const prevHash = last?.hash ?? GENESIS_HASH;
      const payload = { ...input, tenantId: this.tenantId };
      const hash = chainHash(prevHash, payload);
      const res = this.db
        .prepare(
          'INSERT INTO audit_events (id, tenant_id, actor, action, subject_type, subject_id, summary, details_json, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          input.id,
          this.tenantId,
          input.actor,
          input.action,
          input.subjectType,
          input.subjectId,
          input.summary,
          JSON.stringify(input.details ?? null),
          prevHash,
          hash,
          input.createdAt,
        );
      return {
        seq: Number(res.lastInsertRowid),
        tenantId: this.tenantId,
        ...input,
        prevHash,
        hash,
      };
    });
  }

  listAudit(opts: { limit?: number; cursor?: string; action?: string } = {}): Page<AuditRow> {
    const limit = Math.min(Math.max(1, opts.limit ?? 25), MAX_LIMIT);
    const before = opts.cursor ? Number.parseInt(opts.cursor, 10) : Number.MAX_SAFE_INTEGER;
    const params: SQLInputValue[] = [this.tenantId, before];
    let where = 'tenant_id = ? AND seq < ?';
    if (opts.action) {
      where += ' AND action = ?';
      params.push(opts.action);
    }
    const rows = this.db
      .prepare(
        `SELECT seq, id, tenant_id AS tenantId, actor, action, subject_type AS subjectType, subject_id AS subjectId, summary, details_json AS details, prev_hash AS prevHash, hash, created_at AS createdAt FROM audit_events WHERE ${where} ORDER BY seq DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as unknown as (Omit<AuditRow, 'details'> & { details: string })[];
    const items = rows
      .slice(0, limit)
      .map((r) => ({ ...r, details: JSON.parse(r.details) as unknown }));
    const total = (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id = ?')
        .get(this.tenantId) as { n: number }
    ).n;
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit && last ? String(last.seq) : null, total };
  }

  /** Recomputes the whole chain. Returns the first broken sequence number, if any. */
  verifyAudit(): { ok: boolean; count: number; headHash: string; brokenAtSeq: number | null } {
    const rows = this.db
      .prepare(
        'SELECT seq, id, actor, action, subject_type AS subjectType, subject_id AS subjectId, summary, details_json AS details, prev_hash AS prevHash, hash, created_at AS createdAt FROM audit_events WHERE tenant_id = ? ORDER BY seq',
      )
      .all(this.tenantId) as unknown as (Omit<AuditRow, 'details' | 'tenantId'> & {
      details: string;
    })[];
    let prev = GENESIS_HASH;
    for (const r of rows) {
      const payload = {
        id: r.id,
        actor: r.actor,
        action: r.action,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        summary: r.summary,
        details: JSON.parse(r.details) as unknown,
        createdAt: r.createdAt,
        tenantId: this.tenantId,
      };
      if (r.prevHash !== prev || chainHash(prev, payload) !== r.hash) {
        return { ok: false, count: rows.length, headHash: prev, brokenAtSeq: r.seq };
      }
      prev = r.hash;
    }
    return { ok: true, count: rows.length, headHash: prev, brokenAtSeq: null };
  }
}
