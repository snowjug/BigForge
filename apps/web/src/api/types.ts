import type {
  ApprovalDto,
  FamilyMatch,
  Fingerprint,
  JobDto,
  MatcherEvaluation,
  MetricDefinition,
  PersonaDto,
  ReflexSpec,
  ScenarioDto,
  SessionUser,
  TaskDetailDto,
} from '@bigforge/schemas';

/** Shape of every paged list endpoint (`limit <= 100`, opaque `cursor`). */
export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface PageParams {
  limit?: number;
  cursor?: string;
}

export interface TaskListParams extends PageParams {
  status?: 'received' | 'solved' | 'failed' | 'observed';
  origin?: 'intake' | 'noise' | 'canary' | 'reference';
}

export interface RunListParams extends PageParams {
  taskId?: string;
  kind?: string;
}

export interface ComparisonListParams extends PageParams {
  kind?: 'replay' | 'shadow' | 'canary' | 'live';
}

export interface AuditListParams extends PageParams {
  action?: string;
}

export interface EconomicsParams {
  /** Projected future executions (1 to 100000). */
  executions?: number;
  /** true = include learning-task baseline runs in the investment (the conservative view). */
  conservative?: boolean;
}

export type RunMode = 'baseline' | 'auto' | 'compare';

export interface MeResponse {
  user: SessionUser | null;
  mode: 'demo' | 'production';
}

export interface LoginResponse {
  user: SessionUser;
}

export interface PersonasResponse {
  personas: PersonaDto[];
  /** The shared demo password in demo mode, null otherwise. */
  passwordHint: string | null;
}

export type MetricDefinitionsResponse = Record<string, MetricDefinition>;

export interface ScenariosResponse {
  scenarios: ScenarioDto[];
}

export interface MatcherResponse {
  evaluation: MatcherEvaluation | null;
}

export interface MatchTaskResponse {
  task: TaskDetailDto;
  match: FamilyMatch;
  reflexVersionId: string | null;
}

export interface MatchTextResponse {
  fingerprint: Fingerprint;
  match: FamilyMatch;
  reflexVersionId: string | null;
}

export interface ReflexExportResponse {
  spec: ReflexSpec;
  contentHash: string;
}

export interface JobEnvelope {
  job: JobDto;
}

/** `GET /api/approvals` returns the stored rows, which add the version they refer to. */
export interface ApprovalRecord extends ApprovalDto {
  reflexVersionId: string;
}

export interface ApprovalsResponse {
  approvals: ApprovalRecord[];
}

export interface HealthResponse {
  status: string;
  time: string;
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready';
  checks: Record<string, boolean>;
}
