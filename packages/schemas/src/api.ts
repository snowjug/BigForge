import type { EconomicsReport } from './economics';
import type {
  Comparison,
  CompileReport,
  DiffLine,
  DriftVerdict,
  ExecSummary,
  FileChange,
  GateResult,
  TrustWindow,
} from './engine';
import type { FamilyMatch, FamilyMember, Fingerprint, MatcherEvaluation } from './fingerprint';
import type { Provenance } from './common';
import type { PromotionGate, ReflexSpec, ReflexStatus } from './reflex';
import type { ProviderRef, RootFailure, RunKind, Trace, UsageSummary } from './trace';

/** Wire types of the BigForge HTTP API. Shared by the server and the web app. */

export type Role = 'viewer' | 'operator' | 'reviewer' | 'admin';
export type TaskStatus = 'received' | 'solved' | 'failed' | 'observed';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  tenant: { id: string; slug: string; name: string };
}

export interface PersonaDto {
  email: string;
  displayName: string;
  role: Role;
  tenant: { slug: string; name: string };
  blurb: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface SystemDto {
  name: 'BigForge';
  version: string;
  mode: 'demo' | 'production';
  node: string;
  provider: {
    id: string;
    mode: 'deterministic' | 'live';
    label: string;
    liveConfigured: boolean;
    liveKind: string | null;
    notes: string[];
  };
  pricing: { id: string; assumedAt: string; source: string; note: string };
  environment: EnvironmentDto;
  migrations: { current: number };
  claims: { azureDeployed: false; note: string };
}

export interface ScenarioDto {
  id: string;
  role: 'learning' | 'shadow' | 'held_out';
  fault: 'missing_dependency' | 'missing_export' | 'version_mismatch';
  workspace: string;
  ambiguous: boolean;
  variantKey: string;
  title: string;
  prompt: string;
  taskId: string | null;
  taskStatus: TaskStatus | null;
}

export interface EnvironmentDto {
  toolchainVersion: string;
  available: { version: string; description: string }[];
}

export interface TaskDto {
  id: string;
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
  createdAt: string;
}

export interface RunSummaryDto {
  id: string;
  taskId: string;
  kind: RunKind;
  status: string;
  reflexVersionId: string | null;
  groupId: string | null;
  createdAt: string;
  usage: UsageSummary;
  rootFailure: RootFailure | null;
  verification: 'pass' | 'fail' | 'incomplete';
  agent: Trace['agent'];
  provider: ProviderRef;
  outcomeSummary: string;
}

export interface TaskDetailDto extends TaskDto {
  originalLog: string | null;
  runs: RunSummaryDto[];
}

export interface FileChangeDto extends FileChange {
  diff: DiffLine[];
  added: number;
  removed: number;
}

export interface RunDetailDto extends RunSummaryDto {
  trace: Trace;
  changes: FileChangeDto[];
  exec: ExecSummary | null;
  task: { id: string; title: string; scenarioId: string; variantKey: string };
}

export interface RunResultDto {
  task: TaskDto;
  match: FamilyMatch;
  reflexVersionId: string | null;
  primary: RunDetailDto;
  /** A measured baseline reference run on the same task (compare mode). */
  reference: RunDetailDto | null;
  comparison: Comparison | null;
  /** Baseline run started because the Reflex stopped (safe fallback). */
  fallback: RunDetailDto | null;
}

export interface FamilyDto {
  id: string;
  name: string;
  description: string;
  centroid: Fingerprint;
  memberCount: number;
  members: FamilyMember[];
  variants: string[];
  createdAt: string;
  reflexVersionIds: string[];
}

export interface FamilyNodeDto {
  taskId: string;
  scenarioId: string;
  variantKey: string;
  title: string;
  familyId: string | null;
  intent: string;
  failureType: string;
  toolchain: string | null;
  origin: TaskDto['origin'];
}

export interface FamiliesViewDto {
  families: FamilyDto[];
  nodes: FamilyNodeDto[];
  edges: { a: string; b: string; score: number }[];
  matcher: MatcherEvaluation | null;
  thresholds: { match: number; cluster: number; minMembers: number; minVariants: number };
}

export interface ReflexVersionSummaryDto {
  id: string;
  reflexId: string;
  name: string;
  version: string;
  status: ReflexStatus;
  confidence: number;
  trust: TrustWindow;
  contentHash: string;
  familyId: string;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
  mutationOf: string | null;
}

export interface ReflexListDto {
  reflexId: string;
  name: string;
  familyId: string;
  versions: ReflexVersionSummaryDto[];
}

export interface ValidationSummaryDto {
  kind: 'replay' | 'shadow' | 'canary' | 'live';
  runs: number;
  agreements: number;
  agreement: number | null;
  distinctVariants: number;
  safetyViolations: number;
  baseline: {
    meanTokens: number;
    meanModelCalls: number;
    meanCostUsd: number;
    meanCommands: number;
    meanModelLatencyMs: number;
    provenance: Provenance;
  };
  reflex: {
    meanTokens: number;
    meanModelCalls: number;
    meanCostUsd: number;
    meanCommands: number;
    meanLocalMs: number;
    provenance: Provenance;
  };
}

export interface TransitionDto {
  id: string;
  fromStatus: ReflexStatus;
  toStatus: ReflexStatus;
  event: string;
  reason: string;
  actor: string;
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  action: string;
  actorName: string;
  comment: string;
  evidence: unknown;
  createdAt: string;
}

export interface ConfidencePoint {
  at: string;
  confidence: number;
  label: string;
}

export interface ReflexVersionDto extends ReflexVersionSummaryDto {
  spec: ReflexSpec;
  compileReport: CompileReport;
  integrity: { ok: boolean; expected: string; actual: string };
  gate: GateResult;
  gateConfig: PromotionGate;
  replay: ValidationSummaryDto;
  shadow: ValidationSummaryDto;
  canary: ValidationSummaryDto | null;
  transitions: TransitionDto[];
  approvals: ApprovalDto[];
  mutations: MutationDto[];
  confidenceHistory: ConfidencePoint[];
  /** What the current user may do right now (server-enforced regardless). */
  actions: {
    replay: boolean;
    shadow: boolean;
    promote: boolean;
    reject: boolean;
    rollback: boolean;
    canary: boolean;
  };
}

export interface ComparisonDto {
  id: string;
  kind: 'replay' | 'shadow' | 'canary' | 'live';
  reflexVersionId: string;
  taskId: string;
  taskTitle: string;
  scenarioId: string;
  variantKey: string;
  agree: boolean;
  comparison: Comparison;
  baselineRunId: string | null;
  reflexRunId: string;
  createdAt: string;
  baseline: {
    tokens: number;
    calls: number;
    costUsd: number;
    commands: number;
    modelLatencyMs: number;
    localMs: number;
    status: string;
  };
  reflex: {
    tokens: number;
    calls: number;
    costUsd: number;
    commands: number;
    modelLatencyMs: number;
    localMs: number;
    status: string;
  };
}

export interface MutationDiff {
  steps: {
    stepId: string;
    change: 'operator' | 'added' | 'removed';
    from: string | null;
    to: string | null;
  }[];
  assumptions: { added: string[]; removed: string[] };
}

export interface MutationEvidence {
  augmentedTraceIds: string[];
  envVersions: string[];
  regression: {
    runs: number;
    agreements: number;
    agreement: number | null;
    items: { scenarioId: string; env: string; agree: boolean }[];
  };
  activated: false;
}

export interface MutationDto {
  id: string;
  reflexId: string;
  fromVersionId: string;
  toVersionId: string;
  fromVersion: string;
  toVersion: string;
  status: 'proposed' | 'approved' | 'rejected';
  reason: string;
  diff: MutationDiff;
  evidence: MutationEvidence;
  createdAt: string;
  decidedAt: string | null;
}

export interface DriftDetail {
  sample: number;
  pairs: {
    scenarioId: string;
    variantKey: string;
    agree: boolean;
    divergenceStep: string | null;
    reflexStatus: string;
    stopReason: string | null;
    comparisonId: string;
  }[];
  firstDivergence: { stepId: string | null; count: number }[];
  before: { confidence: number; status: ReflexStatus };
  after: { confidence: number; status: ReflexStatus };
  transitions: { from: ReflexStatus; to: ReflexStatus; event: string; reason: string }[];
  canaryCost: { tokens: number; costUsd: number; provenance: Provenance };
  environmentChange: { from: string; to: string } | null;
}

export interface DriftCheckDto {
  id: string;
  reflexVersionId: string;
  envVersion: string;
  verdict: DriftVerdict;
  detail: DriftDetail;
  createdAt: string;
}

export interface DriftViewDto {
  environment: EnvironmentDto;
  reflexVersion: ReflexVersionSummaryDto | null;
  checks: DriftCheckDto[];
  confidenceHistory: ConfidencePoint[];
  mutations: MutationDto[];
  config: { minSamples: number; dropThreshold: number; floor: number; watchBelow: number };
}

export interface AuditEventDto {
  seq: number;
  id: string;
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

export interface AuditVerifyDto {
  ok: boolean;
  count: number;
  headHash: string;
  brokenAtSeq: number | null;
}

export interface SecurityEvaluationDto {
  input: string;
  parsed: { ok: boolean; rule?: string; reason?: string };
  allowlist: {
    ok: boolean;
    rule?: string;
    reason?: string;
    destructive?: boolean;
    normalized?: string;
  };
  permission: { allowed: boolean; rule: string; reason: string } | null;
  verdict: 'would_run' | 'blocked';
  executed: false;
  explanation: string;
}

export interface JobDto {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: { done: number; total: number; label: string };
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SettingsDto {
  gate: PromotionGate;
  drift: { minSamples: number; dropThreshold: number; floor: number; watchBelow: number };
  economics: {
    reviewMinutes: number;
    reviewerUsdPerHour: number;
    projectedExecutions: number;
    includeLearningInInvestment: boolean;
  };
}

export type DemoStepKind = 'action' | 'view' | 'human';

export interface DemoStepDto {
  n: number;
  id: string;
  title: string;
  narration: string;
  scene: string;
  route: string;
  kind: DemoStepKind;
  actionLabel: string | null;
  done: boolean;
}

export interface DemoContext {
  taskIds: Record<string, string>;
  familyId: string | null;
  reflexVersionId: string | null;
  mutatedVersionId: string | null;
  firstRunId: string | null;
  killerRunId: string | null;
  killerReferenceRunId: string | null;
  driftCheckId: string | null;
  mutationId: string | null;
}

export interface DemoStateDto {
  step: number;
  total: number;
  steps: DemoStepDto[];
  completed: number[];
  context: DemoContext;
  /** Progress of the long-running action currently executing, if any (poll while a perform call is pending). */
  activeJob: JobDto | null;
}

export type { EconomicsReport };
