import {
  FINGERPRINT_VERSION,
  type FailureType,
  type FamilyMatch,
  type Fingerprint,
  type HardGate,
  type MatchFeature,
  type MatcherEvaluation,
} from '@bigforge/schemas';

export interface FingerprintInput {
  prompt: string;
  /** CI log or other evidence captured at intake. */
  log: string | null;
}

const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const LEX = {
  failure: [
    'fail',
    'failing',
    'failed',
    'failure',
    'failures',
    'red',
    'broken',
    'broke',
    'break',
    'error',
    'errors',
    'crash',
  ],
  build: ['build', 'builds', 'ci', 'pipeline', 'compile', 'monorepo', 'workspace', 'workspaces'],
  action: [
    'fix',
    'repair',
    'resolve',
    'diagnose',
    'find',
    'track',
    'identify',
    'investigate',
    'why',
    'which',
    'what',
    'root',
    'cause',
  ],
  test: ['test', 'tests', 'flaky', 'assertion', 'unit', 'spec'],
  lint: ['lint', 'linter', 'eslint'],
  deploy: ['deploy', 'deployment', 'staging', 'production', 'rollout'],
  docker: ['docker', 'container', 'image'],
  gradle: ['gradle', 'maven', 'java'],
  python: ['python', 'pytest', 'pip'],
  feature: ['add', 'implement', 'create', 'toggle', 'feature', 'support'],
  deps: ['update', 'upgrade', 'bump', 'dependencies', 'dependency', 'latest'],
  docs: ['write', 'document', 'documentation', 'notes', 'changelog', 'readme'],
  refactor: ['rename', 'refactor', 'move', 'extract'],
  perf: ['slow', 'faster', 'speed', 'optimize', 'performance', 'cache'],
  explain: ['explain', 'describe', 'organised', 'organized', 'overview'],
} as const;

const hits = (tokens: string[], list: readonly string[]): string[] =>
  tokens.filter((t) => list.includes(t));

interface IntentScore {
  label: string;
  score: number;
  terms: string[];
}

function scoreIntents(tokens: string[]): IntentScore[] {
  const failure = hits(tokens, LEX.failure);
  const build = hits(tokens, LEX.build);
  const action = hits(tokens, LEX.action);
  const competing = {
    test: hits(tokens, LEX.test),
    lint: hits(tokens, LEX.lint),
    deploy: hits(tokens, LEX.deploy),
    docker: hits(tokens, LEX.docker),
    gradle: hits(tokens, LEX.gradle),
    python: hits(tokens, LEX.python),
  };
  const competingCount = Object.values(competing).reduce((n, l) => n + (l.length > 0 ? 1 : 0), 0);
  const perf = hits(tokens, LEX.perf);
  const refactor = hits(tokens, LEX.refactor);
  const diagnoseBase =
    (failure.length > 0 ? 1.5 : 0) + (build.length > 0 ? 1.2 : 0) + (action.length > 0 ? 0.6 : 0);
  const gate = failure.length > 0 && build.length > 0;
  return [
    {
      label: 'diagnose_build_failure',
      score: gate
        ? Math.max(0, diagnoseBase - 1.6 * competingCount - (perf.length + refactor.length) * 1.5)
        : 0,
      terms: [...failure, ...build, ...action].slice(0, 8),
    },
    {
      label: 'diagnose_test_failure',
      score: competing.test.length > 0 ? 1.5 + (failure.length > 0 ? 1 : 0) : 0,
      terms: [...competing.test, ...failure],
    },
    {
      label: 'diagnose_lint_failure',
      score: competing.lint.length > 0 ? 2.5 : 0,
      terms: competing.lint,
    },
    {
      label: 'diagnose_deploy_failure',
      score: competing.deploy.length > 0 ? 2.5 : 0,
      terms: competing.deploy,
    },
    {
      label: 'diagnose_container_failure',
      score: competing.docker.length > 0 ? 2.5 : 0,
      terms: competing.docker,
    },
    {
      label: 'diagnose_jvm_failure',
      score: competing.gradle.length > 0 ? 2.5 : 0,
      terms: competing.gradle,
    },
    {
      label: 'add_feature',
      score: hits(tokens, LEX.feature).length > 0 && failure.length === 0 ? 2 : 0,
      terms: hits(tokens, LEX.feature),
    },
    {
      label: 'update_dependencies',
      score: hits(tokens, LEX.deps).length > 0 && failure.length === 0 ? 2 : 0,
      terms: hits(tokens, LEX.deps),
    },
    {
      label: 'write_documentation',
      score: hits(tokens, LEX.docs).length > 0 && failure.length === 0 ? 2 : 0,
      terms: hits(tokens, LEX.docs),
    },
    { label: 'refactor_code', score: refactor.length > 0 ? 2.2 : 0, terms: refactor },
    { label: 'optimize_performance', score: perf.length > 0 ? 2.2 : 0, terms: perf },
    {
      label: 'explain_system',
      score: hits(tokens, LEX.explain).length > 0 ? 2 : 0,
      terms: hits(tokens, LEX.explain),
    },
  ];
}

const LOG_SIGNAL = {
  forgeCi: /\bforge-ci\s+(\d+\.\d+\.\d+)/,
  plan: /\bplan\s+(\d+)\s+workspaces/,
  tsError: /\berror\s+(TS\d+|ERR_[A-Z_]+)\b/g,
  buildFailed: /build failed/g,
};

function detectFailureType(prompt: string, log: string | null): FailureType {
  const text = `${log ?? ''}\n`;
  if (/\berror\s+(TS\d+|ERR_[A-Z_]+)\b|build failed|Cannot find module/.test(text)) return 'build';
  if (/\bFAIL\b|tests? failed|expected .* but received/i.test(text)) return 'test';
  if (/eslint|problems? \(\d+ errors?/i.test(text)) return 'lint';
  if (/deploy|health check|HTTP 5\d\d/i.test(text)) return 'deploy';
  if (/failed to solve|Traceback|TimeoutError|compileJava|What went wrong/i.test(text))
    return 'unknown';
  const tokens = tokenize(prompt);
  if (hits(tokens, LEX.test).length > 0) return 'test';
  if (hits(tokens, LEX.lint).length > 0) return 'lint';
  if (hits(tokens, LEX.deploy).length > 0) return 'deploy';
  return 'unknown';
}

function detectToolchain(log: string | null): { manager: string | null; tool: string | null } {
  if (!log) return { manager: null, tool: null };
  if (LOG_SIGNAL.forgeCi.test(log)) return { manager: 'workspaces', tool: 'forge-ci' };
  if (/gradle|compileJava/i.test(log)) return { manager: null, tool: 'gradle' };
  if (/docker|failed to solve/i.test(log)) return { manager: null, tool: 'docker' };
  if (/Traceback|python/i.test(log)) return { manager: null, tool: 'python' };
  if (/eslint/i.test(log)) return { manager: null, tool: 'eslint' };
  return { manager: null, tool: null };
}

export function extractFingerprint(input: FingerprintInput): Fingerprint {
  const tokens = tokenize(input.prompt);
  const scored = scoreIntents(tokens).sort((a, b) => b.score - a.score);
  const total = scored.reduce((n, s) => n + s.score, 0);
  const best = scored[0];
  const intent =
    best && best.score > 0
      ? {
          label: best.label,
          confidence: Math.round((best.score / total) * 100) / 100,
          terms: [...new Set(best.terms)],
        }
      : { label: 'unknown', confidence: 0, terms: [] };

  const log = input.log;
  const toolchain = detectToolchain(log);
  const failureType = detectFailureType(input.prompt, log);
  const signatures = log
    ? [...new Set([...log.matchAll(LOG_SIGNAL.tsError)].map((m) => m[1] as string))].sort()
    : [];
  const failedWorkspaces = log ? (log.match(LOG_SIGNAL.buildFailed) ?? []).length : 0;
  const workspaceCount = log ? Number(LOG_SIGNAL.plan.exec(log)?.[1] ?? NaN) : NaN;
  const files = new Set<string>();
  if (log) {
    for (const m of log.matchAll(/\bat\s+(\S+?):\d+:\d+/g)) {
      const file = m[1] as string;
      files.add(file.endsWith('package.json') ? 'manifest' : 'source');
    }
  }
  const capabilities =
    toolchain.tool === 'forge-ci' && failureType === 'build'
      ? ['exec:forge-ci', 'read:repo', 'write:workspace']
      : [];

  return {
    version: FINGERPRINT_VERSION,
    intent,
    toolchain,
    repo: {
      workspaceCount: Number.isFinite(workspaceCount) ? workspaceCount : null,
      layout: Number.isFinite(workspaceCount) && workspaceCount >= 2 ? 'monorepo' : null,
    },
    failure: { type: failureType, signatures, cascading: failedWorkspaces >= 2 },
    files: [...files].sort(),
    capabilities,
  };
}

const jaccard = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const inter = b.filter((x) => sa.has(x)).length;
  return inter / (sa.size + new Set(b).size - inter);
};

const containment = (subset: readonly string[], superset: readonly string[]): number => {
  if (subset.length === 0) return 1;
  const sup = new Set(superset);
  return subset.filter((x) => sup.has(x)).length / subset.length;
};

const eq = (a: unknown, b: unknown): number => (a !== null && a !== undefined && a === b ? 1 : 0);

export interface Comparison {
  score: number;
  features: MatchFeature[];
  hardGates: HardGate[];
}

const WEIGHTS = {
  intent: 0.3,
  failure_type: 0.2,
  toolchain: 0.2,
  error_signatures: 0.1,
  repo_shape: 0.1,
  files: 0.05,
  capabilities: 0.05,
};

/**
 * Compares a task fingerprint with a family centroid. Hard gates catch the dangerous cases
 * (different intent, toolchain or failure type; unknown error classes; missing evidence).
 */
export function compareFingerprints(
  task: Fingerprint,
  family: Fingerprint,
  signatureMode: 'containment' | 'jaccard' = 'containment',
): Comparison {
  const signature =
    signatureMode === 'containment'
      ? containment(task.failure.signatures, family.failure.signatures)
      : jaccard(task.failure.signatures, family.failure.signatures);
  const features: MatchFeature[] = [
    {
      name: 'intent',
      score: eq(task.intent.label, family.intent.label),
      weight: WEIGHTS.intent,
      detail: `${task.intent.label} vs ${family.intent.label}`,
    },
    {
      name: 'failure_type',
      score: eq(task.failure.type, family.failure.type),
      weight: WEIGHTS.failure_type,
      detail: `${task.failure.type} vs ${family.failure.type}`,
    },
    {
      name: 'toolchain',
      score: eq(task.toolchain.tool, family.toolchain.tool),
      weight: WEIGHTS.toolchain,
      detail: `${task.toolchain.tool ?? 'unknown'} vs ${family.toolchain.tool ?? 'unknown'}`,
    },
    {
      name: 'error_signatures',
      score: signature,
      weight: WEIGHTS.error_signatures,
      detail: `[${task.failure.signatures.join(', ')}] vs known [${family.failure.signatures.join(', ')}]`,
    },
    {
      name: 'repo_shape',
      score: eq(task.repo.layout, family.repo.layout),
      weight: WEIGHTS.repo_shape,
      detail: `${task.repo.layout ?? 'unknown'} vs ${family.repo.layout ?? 'unknown'}`,
    },
    {
      name: 'files',
      score: jaccard(task.files, family.files),
      weight: WEIGHTS.files,
      detail: `[${task.files.join(', ')}] vs [${family.files.join(', ')}]`,
    },
    {
      name: 'capabilities',
      score: jaccard(task.capabilities, family.capabilities),
      weight: WEIGHTS.capabilities,
      detail: `[${task.capabilities.join(', ')}]`,
    },
  ];
  const score = features.reduce((n, f) => n + f.score * f.weight, 0);
  const known = containment(task.failure.signatures, family.failure.signatures) === 1;
  const hardGates: HardGate[] = [
    {
      id: 'evidence_present',
      passed: task.toolchain.tool !== null && task.failure.type !== 'unknown',
      detail:
        task.toolchain.tool === null
          ? 'No toolchain evidence in the captured log'
          : `Toolchain "${task.toolchain.tool}", failure "${task.failure.type}" observed`,
    },
    {
      id: 'intent',
      passed: task.intent.label === family.intent.label,
      detail: `${task.intent.label} ${task.intent.label === family.intent.label ? '==' : '!='} ${family.intent.label}`,
    },
    {
      id: 'toolchain',
      passed: task.toolchain.tool === family.toolchain.tool,
      detail: `${task.toolchain.tool ?? 'unknown'} ${task.toolchain.tool === family.toolchain.tool ? '==' : '!='} ${family.toolchain.tool ?? 'unknown'}`,
    },
    {
      id: 'failure_type',
      passed: task.failure.type === family.failure.type,
      detail: `${task.failure.type} ${task.failure.type === family.failure.type ? '==' : '!='} ${family.failure.type}`,
    },
    {
      id: 'known_error_classes',
      passed: known,
      detail: known
        ? 'All error signatures are known to the family'
        : `Unknown error class in [${task.failure.signatures.join(', ')}]`,
    },
  ];
  return { score: Math.round(score * 1000) / 1000, features, hardGates };
}

export const MATCH_THRESHOLD = 0.8;
export const AMBIGUOUS_THRESHOLD = 0.6;

export function matchFamily(
  task: Fingerprint,
  family: { id: string; name: string; centroid: Fingerprint } | null,
  threshold = MATCH_THRESHOLD,
): FamilyMatch {
  if (!family) {
    return {
      decision: 'no_match',
      familyId: null,
      familyName: null,
      score: 0,
      threshold,
      hardGates: [],
      features: [],
      reasons: ['No task family exists yet: the baseline agent handles this task'],
    };
  }
  const cmp = compareFingerprints(task, family.centroid);
  const failedGates = cmp.hardGates.filter((g) => !g.passed);
  const reasons: string[] = [];
  let decision: FamilyMatch['decision'];
  if (failedGates.length > 0) {
    decision = 'no_match';
    reasons.push(`Hard gate failed: ${failedGates.map((g) => g.id).join(', ')}`);
  } else if (cmp.score >= threshold) {
    decision = 'match';
    reasons.push(`All hard gates passed and similarity ${cmp.score.toFixed(2)} >= ${threshold}`);
  } else if (cmp.score >= AMBIGUOUS_THRESHOLD) {
    decision = 'ambiguous';
    reasons.push(
      `Similarity ${cmp.score.toFixed(2)} is below the match threshold ${threshold}: the baseline agent handles it`,
    );
  } else {
    decision = 'no_match';
    reasons.push(
      `Similarity ${cmp.score.toFixed(2)} is far below the match threshold ${threshold}`,
    );
  }
  return {
    decision,
    familyId: decision === 'match' ? family.id : null,
    familyName: decision === 'match' ? family.name : null,
    score: cmp.score,
    threshold,
    hardGates: cmp.hardGates,
    features: cmp.features,
    reasons,
  };
}

const mode = <T extends string | number>(values: T[]): T | null => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of [...counts.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])),
  )) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
};

/** Representative fingerprint for a set of tasks: modal categorical features, union of sets. */
export function centroidOf(fps: Fingerprint[]): Fingerprint {
  const first = fps[0];
  if (!first) throw new Error('Cannot compute the centroid of an empty set');
  const union = (pick: (f: Fingerprint) => string[]) => [...new Set(fps.flatMap(pick))].sort();
  const counts = fps.map((f) => f.repo.workspaceCount).filter((n): n is number => n !== null);
  return {
    version: FINGERPRINT_VERSION,
    intent: {
      label: mode(fps.map((f) => f.intent.label)) ?? first.intent.label,
      confidence:
        Math.round((fps.reduce((n, f) => n + f.intent.confidence, 0) / fps.length) * 100) / 100,
      terms: union((f) => f.intent.terms).slice(0, 10),
    },
    toolchain: {
      manager: mode(fps.map((f) => f.toolchain.manager ?? '')) || null,
      tool: mode(fps.map((f) => f.toolchain.tool ?? '')) || null,
    },
    repo: {
      workspaceCount: counts.length ? (mode(counts) ?? null) : null,
      layout: mode(fps.map((f) => f.repo.layout ?? '')) || null,
    },
    failure: {
      type: mode(fps.map((f) => f.failure.type)) ?? 'unknown',
      signatures: union((f) => f.failure.signatures),
      cascading: fps.filter((f) => f.failure.cascading).length * 2 >= fps.length,
    },
    files: union((f) => f.files),
    capabilities: union((f) => f.capabilities),
  };
}

export interface ClusterItem {
  id: string;
  fingerprint: Fingerprint;
}

export interface Cluster {
  memberIds: string[];
  centroid: Fingerprint;
}

/**
 * Single-link threshold clustering over symmetric fingerprint similarity.
 * Deterministic: items are processed in input order. Hard gates apply: two tasks with different
 * intent, toolchain or failure type are never linked.
 */
export function clusterFingerprints(items: ClusterItem[], threshold = 0.75): Cluster[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      const cmp = compareFingerprints(a.fingerprint, b.fingerprint, 'jaccard');
      const gatesOk = cmp.hardGates
        .filter((g) => g.id !== 'known_error_classes')
        .every((g) => g.passed);
      if (gatesOk && cmp.score >= threshold) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, ClusterItem[]>();
  items.forEach((item, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), item]);
  });
  return [...groups.values()].map((members) => ({
    memberIds: members.map((m) => m.id),
    centroid: centroidOf(members.map((m) => m.fingerprint)),
  }));
}

export interface LabelledFingerprint {
  label: string;
  isInFamily: boolean;
  fingerprint: Fingerprint;
}

/** Measures false-match and miss rates on a labelled synthetic corpus. */
export function evaluateMatcher(
  family: { id: string; name: string; centroid: Fingerprint },
  corpus: LabelledFingerprint[],
  threshold = MATCH_THRESHOLD,
): MatcherEvaluation {
  let truePositives = 0;
  let falseMatches = 0;
  const misses: { label: string; score: number }[] = [];
  const falseMatchExamples: { label: string; score: number }[] = [];
  for (const item of corpus) {
    const m = matchFamily(item.fingerprint, family, threshold);
    if (item.isInFamily) {
      if (m.decision === 'match') truePositives += 1;
      else misses.push({ label: item.label, score: m.score });
    } else if (m.decision === 'match') {
      falseMatches += 1;
      falseMatchExamples.push({ label: item.label, score: m.score });
    }
  }
  const positives = corpus.filter((c) => c.isInFamily).length;
  const negatives = corpus.length - positives;
  return {
    provenance: 'measured',
    corpus: 'synthetic',
    positives,
    negatives,
    truePositives,
    falseMatches,
    falseMatchRate: negatives === 0 ? 0 : falseMatches / negatives,
    recall: positives === 0 ? 0 : truePositives / positives,
    threshold,
    misses,
    falseMatchExamples,
  };
}
