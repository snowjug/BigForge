import type { BoundaryResolution } from './firewall';
import type { RootFailure, RunKind, UsageSummary } from './trace';

/**
 * Engine result shapes shared by the server and the web app (pure types, no runtime code).
 */

export interface StepResult {
  stepId: string;
  operator: string;
  status: 'ok' | 'escalated' | 'stopped' | 'skipped';
  executor: 'local' | 'model';
  summary: string;
  confidence?: number;
}

export interface AlignmentCell {
  key: string;
  present: boolean;
  count: number;
  detail: string;
}

export interface AlignmentColumn {
  key: string;
  kind: 'turn' | 'decision';
  conservation: number;
  presentIn: number;
  meanPosition: number;
  baselineTokens: number;
  variableSlots: string[];
  classification: 'invariant' | 'common' | 'variable';
  replacedBy: string | null;
}

export interface AlignmentRow {
  traceId: string;
  scenarioId: string;
  variantKey: string;
  cells: AlignmentCell[];
}

export interface StepDecision {
  stepId: string;
  chosen: string;
  alternatives: {
    operator: string;
    consistent: boolean;
    matched: number;
    of: number;
    detail: string;
  }[];
  reason: string;
}

export interface CompileReport {
  compilerVersion: string;
  tracesUsed: number;
  variants: string[];
  columns: AlignmentColumn[];
  rows: AlignmentRow[];
  decisions: StepDecision[];
  excludedBehaviours: { purpose: string; occurrences: number; reason: string }[];
  uncovered: string[];
  baselineTokensPerTask: number;
  baselineModelCallsPerTask: number;
  /** Wall-clock time of the deterministic compile (measured, set by the platform). */
  compileMs?: number;
}

export interface FileChangeLike {
  file: string;
  after: string;
}

export interface FileChange {
  file: string;
  before: string;
  after: string;
}

export interface RunDigest {
  runId: string;
  traceId: string;
  kind: RunKind;
  status: 'success' | 'failed' | 'stopped' | 'fallback';
  verification: 'pass' | 'fail' | 'incomplete';
  rootFailure: RootFailure | null;
  changes: FileChangeLike[];
  usage: UsageSummary;
  stopReason: string | null;
  stopStepId: string | null;
  safetyViolations: number;
}

export interface ComparisonCheck {
  id: 'outcome' | 'verification' | 'root_cause' | 'patch' | 'safety';
  label: string;
  baseline: string;
  reflex: string;
  match: boolean;
}

export interface Divergence {
  stepId: string | null;
  kind: 'root_cause' | 'remedy' | 'stopped' | 'verification' | 'none';
  detail: string;
}

export interface Comparison {
  agree: boolean;
  checks: ComparisonCheck[];
  divergence: Divergence;
  deltas: {
    modelCalls: number;
    tokens: number;
    costUsd: number;
    commands: number;
    modelLatencyMs: number;
    localMs: number;
  };
}

export interface GateCheck {
  id: 'replay' | 'shadow_runs' | 'variants' | 'safety' | 'agreement';
  label: string;
  required: string;
  actual: string;
  passed: boolean;
}

export interface GateResult {
  eligible: boolean;
  checks: GateCheck[];
}

export interface TrustWindow {
  confidence: number;
  successes: number;
  n: number;
  interval: { low: number; high: number };
}

export interface DriftVerdict {
  drift: boolean;
  samples: number;
  historicAgreement: number;
  currentAgreement: number;
  drop: number;
  interval: { low: number; high: number };
  reasons: string[];
}

export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface ExecSummary {
  status: 'completed' | 'stopped';
  stopReason: string | null;
  stopStepId: string | null;
  steps: StepResult[];
  boundaries: BoundaryResolution[];
  evidenceTokens: number;
  crr: number | null;
  outputs: { report: string | null };
}
