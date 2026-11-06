import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_FIREWALL_POLICY,
  type OperatorLibrary,
  Sandbox,
  randomIds,
  systemClock,
} from '@bigforge/core';
import { createMonorepoLibrary, forgeCiPolicy, monorepoPolicies } from '@bigforge/lab-monorepo';
import { DEFAULT_PRICING, DeterministicProvider, type Provider } from '@bigforge/providers';
import type { PricingConfig } from '@bigforge/schemas';
import {
  AGENT_PERMISSIONS,
  type EngineDeps,
  type MaterializedTask,
  materialize,
  probeEnvironment,
} from './execution';
import type { PreparedTrace } from '@bigforge/core';
import type { Trace } from '@bigforge/schemas';
import { getScenario, type LabEnvironment } from '@bigforge/lab-monorepo';

export interface EngineOptions {
  dataDir: string;
  provider?: Provider;
  pricing?: PricingConfig;
  library?: OperatorLibrary;
  keepWorkspaces?: boolean;
}

/** Wires the execution engine for the synthetic monorepo lab. Deterministic provider unless a provider is supplied. */
export async function createEngine(options: EngineOptions): Promise<EngineDeps> {
  await mkdir(path.join(options.dataDir, 'workspaces'), { recursive: true });
  return {
    dataDir: options.dataDir,
    provider: options.provider ?? new DeterministicProvider(monorepoPolicies()),
    pricing: options.pricing ?? DEFAULT_PRICING,
    ids: randomIds(),
    clock: systemClock,
    library: options.library ?? createMonorepoLibrary(),
    firewallPolicy: DEFAULT_FIREWALL_POLICY,
    ...(options.keepWorkspaces !== undefined ? { keepWorkspaces: options.keepWorkspaces } : {}),
  };
}

/** Rebuilds a recorded task's starting state so the compiler can test operators on it. */
export function preparerFor(deps: EngineDeps, envFor: (trace: Trace) => LabEnvironment) {
  return async (trace: Trace): Promise<PreparedTrace> => {
    const spec = getScenario(trace.task.scenarioId);
    const mt: MaterializedTask = await materialize(deps, spec, envFor(trace));
    return {
      sandbox: new Sandbox({
        root: mt.root,
        commandPolicy: deps.commandPolicy ?? forgeCiPolicy(),
        permissions: AGENT_PERMISSIONS,
      }),
      inputs: { ci_log: 'ci/last-build.log' },
      env: await probeEnvironment(mt.root),
      dispose: () => mt.dispose(),
    };
  };
}
