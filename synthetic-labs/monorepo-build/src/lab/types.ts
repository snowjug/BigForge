export const FAULT_KINDS = ['missing_dependency', 'missing_export', 'version_mismatch'] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export const SCENARIO_ROLES = ['learning', 'shadow', 'held_out'] as const;
export type ScenarioRole = (typeof SCENARIO_ROLES)[number];

export const TOOLCHAIN_VERSIONS = ['1.4.2', '1.5.0'] as const;
export type ToolchainVersion = (typeof TOOLCHAIN_VERSIONS)[number];

export interface LabEnvironment {
  toolchainVersion: ToolchainVersion;
}

export const DEFAULT_ENVIRONMENT: LabEnvironment = { toolchainVersion: '1.4.2' };

export interface ScenarioDetail {
  /** missing_dependency: the third-party module that is imported but not declared. */
  module?: string;
  /** missing_export: the dependency workspace and the stale/requested name. */
  dependency?: string;
  requested?: string;
  /** missing_export: names that exist in the dependency and could plausibly be meant. */
  expectedChoice?: string;
  /** version_mismatch: dependency whose range is wrong. */
  range?: string;
}

export interface ScenarioSpec {
  id: string;
  role: ScenarioRole;
  fault: FaultKind;
  /** Workspace that contains the root cause, e.g. "packages/security". */
  workspace: string;
  /** Build seed: controls log noise and (in toolchain 1.5.x) completion ordering. */
  seed: number;
  /** True when more than one plausible remedy exists (forces an uncertainty boundary). */
  ambiguous: boolean;
  /** Distinct variant: fault kind (+ambiguity) at a workspace. */
  variantKey: string;
  title: string;
  prompt: string;
  detail: ScenarioDetail;
  /** Ground truth, used for tests and demo narration. Never shown to agents. */
  expected: { rootWorkspace: string; code: string };
}

export interface NegativeTask {
  id: string;
  title: string;
  prompt: string;
  /** Optional log excerpt the intake would have captured. */
  log: string | null;
  reason: string;
}
