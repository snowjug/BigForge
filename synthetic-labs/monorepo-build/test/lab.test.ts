import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  centroidOf,
  clusterFingerprints,
  evaluateMatcher,
  extractFingerprint,
  matchFamily,
} from '@bigforge/core';
import { runCommand } from '@bigforge/security';
import {
  NEGATIVE_TASKS,
  SCENARIOS,
  forgeCiPolicy,
  getScenario,
  healthyRepo,
  locateRoot,
  parseBuildLog,
  parseGraph,
  scenarioRepo,
  writeRepo,
  type LabEnvironment,
} from '../src';

const dirs: string[] = [];
const policy = forgeCiPolicy();

async function forge(files: Record<string, string>, args: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'bf-lab-'));
  dirs.push(root);
  await writeRepo(root, files);
  return runCommand({ spec: { program: 'forge-ci', args }, policy, root });
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const V1: LabEnvironment = { toolchainVersion: '1.4.2' };
const V2: LabEnvironment = { toolchainVersion: '1.5.0' };

describe('forge-ci and the scenario generator', () => {
  it('builds the healthy repository cleanly in both toolchain versions', async () => {
    for (const env of [V1, V2]) {
      const r = await forge(healthyRepo(env, 1), ['build']);
      expect(r.exitCode, env.toolchainVersion).toBe(0);
      expect(r.stdout).toContain('build passed');
    }
  });

  it('every scenario fails with exactly its documented root cause', async () => {
    for (const spec of SCENARIOS) {
      const build = await forge(scenarioRepo(spec, V1), ['build']);
      expect(build.exitCode, spec.id).toBe(1);
      const graphRun = await forge(scenarioRepo(spec, V1), ['graph', '--json']);
      const root = locateRoot(
        parseBuildLog(build.stdout).errors,
        parseGraph(graphRun.stdout),
        'dependency_graph',
      );
      expect(root?.workspace, spec.id).toBe(spec.expected.rootWorkspace);
      expect(root?.code, spec.id).toBe(spec.expected.code);
    }
  });

  it('1.4.2 lists the root failure first; 1.5.0 parallel builds reorder it for exactly the designed tasks', async () => {
    const firstIsRoot = async (id: string, env: LabEnvironment) => {
      const spec = getScenario(id);
      const out = (await forge(scenarioRepo(spec, env), ['build'])).stdout;
      return parseBuildLog(out).errors[0]?.workspace === spec.workspace;
    };
    for (const spec of SCENARIOS)
      expect(await firstIsRoot(spec.id, V1), `${spec.id} on 1.4.2`).toBe(true);
    for (const id of ['S5', 'S6', 'S10'])
      expect(await firstIsRoot(id, V2), `${id} on 1.5.0`).toBe(false);
    for (const id of ['S1', 'S2', 'S3', 'S4'])
      expect(await firstIsRoot(id, V2), `${id} on 1.5.0`).toBe(true);
  });

  it('distinguishes a build that compiles from a repair that is actually right (contract test)', async () => {
    const wrong = scenarioRepo(getScenario('K1'), V1);
    const session = 'packages/auth/src/session.ts';
    wrong[session] = (wrong[session] ?? '').replaceAll('signJwt', 'signToken');
    expect((await forge(wrong, ['build'])).exitCode).toBe(0);
    const tests = await forge(wrong, ['test', '--workspace', 'packages/auth']);
    expect(tests.exitCode).toBe(1);
    expect(tests.stdout).toContain('expected a call to signAccessToken');
    const right = scenarioRepo(getScenario('K1'), V1);
    right[session] = (right[session] ?? '').replaceAll('signJwt', 'signAccessToken');
    expect((await forge(right, ['test', '--workspace', 'packages/auth'])).exitCode).toBe(0);
  });

  it('redacts nothing itself but plants a fake secret for the redaction path to prove', async () => {
    const log = (await forge(scenarioRepo(getScenario('L1'), V1), ['build'])).stdout;
    expect(log).toContain('frg_demo_NOT_A_REAL_SECRET_0001');
  });

  it('rejects unknown subcommands and unconfined workspaces at the policy layer', async () => {
    const files = healthyRepo(V1, 1);
    expect((await forge(files, ['deploy'])).status).toBe('blocked');
    const root = await mkdtemp(path.join(tmpdir(), 'bf-lab-'));
    dirs.push(root);
    await writeRepo(root, files);
    const r = await runCommand({
      spec: { program: 'forge-ci', args: ['build', '--workspace', '../../etc'] },
      policy,
      root,
    });
    expect(r.status).toBe('blocked');
    expect(r.blockedRule).toBe('path_traversal');
  });
});

describe('task fingerprinting and matching', () => {
  const logs = new Map<string, string>();
  const logFor = async (id: string) => {
    if (!logs.has(id))
      logs.set(id, (await forge(scenarioRepo(getScenario(id), V1), ['build'])).stdout);
    return logs.get(id) as string;
  };

  it('recognises every paraphrase and every variant as the same family, and nothing else', async () => {
    const learning = await Promise.all(
      ['L1', 'L2', 'L3', 'L4', 'L5'].map(async (id) => ({
        id,
        fingerprint: extractFingerprint({ prompt: getScenario(id).prompt, log: await logFor(id) }),
      })),
    );
    const clusters = clusterFingerprints(learning);
    expect(clusters).toHaveLength(1);
    const family = {
      id: 'fam',
      name: 'Monorepo build failure (forge-ci)',
      centroid: centroidOf(learning.map((l) => l.fingerprint)),
    };

    const corpus = [
      ...(await Promise.all(
        SCENARIOS.map(async (s) => ({
          label: s.id,
          isInFamily: true,
          fingerprint: extractFingerprint({ prompt: s.prompt, log: await logFor(s.id) }),
        })),
      )),
      ...NEGATIVE_TASKS.map((n) => ({
        label: n.id,
        isInFamily: false,
        fingerprint: extractFingerprint({ prompt: n.prompt, log: n.log }),
      })),
    ];
    const evalResult = evaluateMatcher(family, corpus);
    expect(evalResult.falseMatches, JSON.stringify(evalResult.falseMatchExamples)).toBe(0);
    expect(evalResult.misses, JSON.stringify(evalResult.misses)).toEqual([]);
    expect(evalResult.positives).toBe(18);
    expect(evalResult.negatives).toBe(12);
    expect(evalResult.provenance).toBe('measured');
    expect(evalResult.corpus).toBe('synthetic');
  });

  it('never matches when the toolchain, failure type or error class is unknown (hard gates)', async () => {
    const learning = await Promise.all(
      ['L1', 'L2', 'L3'].map(async (id) =>
        extractFingerprint({ prompt: getScenario(id).prompt, log: await logFor(id) }),
      ),
    );
    const family = { id: 'fam', name: 'f', centroid: centroidOf(learning) };
    const base = getScenario('L1').prompt;
    const unknownClass = (await logFor('L1')).replace('TS2307', 'TS2345');
    const m1 = matchFamily(extractFingerprint({ prompt: base, log: unknownClass }), family);
    expect(m1.decision).toBe('no_match');
    expect(m1.hardGates.find((g) => g.id === 'known_error_classes')?.passed).toBe(false);
    const noEvidence = matchFamily(extractFingerprint({ prompt: base, log: null }), family);
    expect(noEvidence.decision).toBe('no_match');
    expect(noEvidence.hardGates.find((g) => g.id === 'evidence_present')?.passed).toBe(false);
    expect(
      matchFamily(extractFingerprint({ prompt: base, log: await logFor('L1') }), null).decision,
    ).toBe('no_match');
  });
});
