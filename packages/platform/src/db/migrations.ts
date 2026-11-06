export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Versioned, append-only migrations. Applied migrations are checksummed: editing one after it
 * has been applied is an error. Add a new migration instead.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','operator','reviewer','admin')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (email)
);

CREATE TABLE settings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  scenario_id TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  scenario_role TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  env_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','solved','failed','observed')),
  origin TEXT NOT NULL,
  fingerprint_json TEXT NOT NULL,
  match_json TEXT,
  family_id TEXT,
  original_log TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_tenant ON tasks (tenant_id, created_at);
CREATE INDEX idx_tasks_scenario ON tasks (tenant_id, scenario_id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  reflex_version_id TEXT,
  group_id TEXT,
  trace_json TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  exec_json TEXT,
  usage_json TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  model_calls INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_runs_task ON runs (tenant_id, task_id);
CREATE INDEX idx_runs_kind ON runs (tenant_id, kind, created_at);
CREATE INDEX idx_runs_reflex ON runs (tenant_id, reflex_version_id);

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  centroid_json TEXT NOT NULL,
  members_json TEXT NOT NULL,
  variants_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_families_tenant ON families (tenant_id, created_at);

CREATE TABLE reflexes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  family_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE reflex_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reflex_id TEXT NOT NULL REFERENCES reflexes(id),
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  compile_report_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  trust_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reflex_id, version)
);
CREATE INDEX idx_rv_tenant ON reflex_versions (tenant_id, created_at);

CREATE TABLE reflex_transitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reflex_version_id TEXT NOT NULL REFERENCES reflex_versions(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  event TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rt_version ON reflex_transitions (tenant_id, reflex_version_id, created_at);

CREATE TABLE comparisons (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('replay','shadow','canary','live')),
  reflex_version_id TEXT NOT NULL REFERENCES reflex_versions(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  baseline_run_id TEXT,
  reflex_run_id TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  agree INTEGER NOT NULL,
  comparison_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cmp_version ON comparisons (tenant_id, reflex_version_id, kind, created_at);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reflex_version_id TEXT NOT NULL REFERENCES reflex_versions(id),
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_appr_version ON approvals (tenant_id, reflex_version_id, created_at);

CREATE TABLE mutations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reflex_id TEXT NOT NULL REFERENCES reflexes(id),
  from_version_id TEXT NOT NULL,
  to_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected')),
  reason TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_mut_tenant ON mutations (tenant_id, created_at);

CREATE TABLE drift_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reflex_version_id TEXT NOT NULL REFERENCES reflex_versions(id),
  env_version TEXT NOT NULL,
  verdict_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_drift_version ON drift_checks (tenant_id, reflex_version_id, created_at);

CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
  reflex_version_id TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  model_calls INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  token_provenance TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ledger_tenant ON ledger (tenant_id, category, created_at);

CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_tenant ON audit_events (tenant_id, seq);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  params_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_jobs_status ON jobs (status, created_at);
CREATE INDEX idx_jobs_tenant ON jobs (tenant_id, created_at);

CREATE TABLE demo_state (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  step INTEGER NOT NULL,
  completed_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
];
