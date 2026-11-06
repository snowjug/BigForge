import { type LogError, type WorkspaceGraph, workspaceByName, workspaceByPath } from './logparse';

export type FileMap = Record<string, string>;

export interface Patch {
  file: string;
  edits: { search: string; replace: string }[];
}

export interface Remedy {
  kind: 'add_dependency' | 'rename_import' | 'fix_workspace_range';
  description: string;
  patch: Patch;
}

export interface Candidate {
  id: string;
  label: string;
  detail: string;
  payload: Remedy;
  score: number;
}

export interface EvidenceDraft {
  source: string;
  text: string;
  tags: string[];
}

export interface RemedyAnalysis {
  candidates: Candidate[];
  confidence: number;
  summary: string;
  evidence: EvidenceDraft[];
}

export interface FileNeed {
  path: string;
  purpose: string;
}

// ---------- name similarity ----------

function splitCamel(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function isSubsequence(small: string, big: string): boolean {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i += 1;
  return i === small.length;
}

function tokenMatch(x: string, y: string): number {
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 3 && long.startsWith(short)) return 0.8;
  if (short.length >= 2 && isSubsequence(short, long) && short[0] === long[0]) return 0.7;
  return 0;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j += 1) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      (dp[i] as number[])[j] = Math.min(
        (dp[i - 1] as number[])[j]! + 1,
        (dp[i] as number[])[j - 1]! + 1,
        (dp[i - 1] as number[])[j - 1]! + cost,
      );
    }
  }
  return (dp[a.length] as number[])[b.length] as number;
}

/** 0..1 similarity between two identifiers: token overlap (with abbreviations) blended with edit distance. */
export function nameSimilarity(a: string, b: string): number {
  const ta = splitCamel(a);
  const tb = splitCamel(b);
  const tokenScore =
    ta.reduce((n, x) => n + Math.max(0, ...tb.map((y) => tokenMatch(x, y))), 0) /
    Math.max(ta.length, tb.length, 1);
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  const lev = 1 - editDistance(la, lb) / Math.max(la.length, lb.length, 1);
  return Math.round((0.6 * tokenScore + 0.4 * lev) * 1000) / 1000;
}

/** Confidence that the top-ranked candidate is THE answer: depends on both its score and its margin. */
export function candidateConfidence(scores: number[]): number {
  const sorted = [...scores].sort((a, b) => b - a);
  const s1 = sorted[0] ?? 0;
  const s2 = sorted[1] ?? 0;
  if (sorted.length === 0) return 0;
  const margin = s1 - s2;
  let conf = 0.4 + 0.6 * Math.min(1, margin / 0.3);
  if (s1 < 0.35) conf *= 0.5;
  return Math.round(conf * 100) / 100;
}

// ---------- exports of a workspace ----------

export interface ExportInfo {
  name: string;
  signature: string;
  doc: string;
  params: { name: string; type: string }[];
  file: string;
}

function parseParams(signature: string): { name: string; type: string }[] {
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open === -1 || close <= open) return [];
  const inner = signature.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if ('<([{'.includes(ch)) depth += 1;
    if ('>)]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => {
    const [name = '', ...type] = p.split(':');
    return { name: name.trim().replace(/[?=].*$/, ''), type: type.join(':').trim() };
  });
}

/** Collects exported symbols (with JSDoc and signature) from a source file's text. */
export function exportsOf(file: string, text: string): ExportInfo[] {
  const out: ExportInfo[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m =
      /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(
        line,
      );
    if (!m) return;
    const doc: string[] = [];
    for (let k = i - 1; k >= 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[k] as string); k -= 1)
      doc.unshift((lines[k] as string).trim());
    out.push({
      name: m[1] as string,
      signature: line.replace(/\s*\{\s*$/, '').trim(),
      doc: doc.join(' '),
      params: parseParams(line),
      file,
    });
  });
  return out;
}

/** Re-export targets of `export * from './x'` lines, as workspace-relative paths. */
export function reExportTargets(indexFile: string, text: string): string[] {
  const dir = indexFile.split('/').slice(0, -1).join('/');
  return [...text.matchAll(/^export\s*\*\s*from\s*['"]\.\/([^'"]+)['"]/gm)].map(
    (m) => `${dir}/${m[1] as string}.ts`,
  );
}

// ---------- what to read next ----------

export function packageDir(workspacePath: string): string {
  return workspacePath;
}

/**
 * Which file must be read next to decide on a remedy, given what has been read so far.
 * Both the baseline agent policy and the Reflex operator follow this same protocol, so they
 * gather identical evidence and reach identical candidates.
 */
export function nextFileNeeded(
  root: LogError,
  files: FileMap,
  graph: WorkspaceGraph,
): FileNeed | null {
  if (root.code === 'TS2307') {
    const module = /Cannot find module '([^']+)'/.exec(root.message)?.[1] ?? '';
    if (workspaceByName(graph, module)) return null;
    return files['forge.lock.json'] === undefined
      ? { path: 'forge.lock.json', purpose: 'inspect_lockfile' }
      : null;
  }
  if (root.code === 'TS2305') {
    const module = /Module '([^']+)'/.exec(root.message)?.[1] ?? '';
    const dep = workspaceByName(graph, module);
    if (!dep || !root.file) return null;
    if (files[root.file] === undefined)
      return { path: root.file, purpose: 'inspect_failing_source' };
    const index = `${dep.path}/src/index.ts`;
    if (files[index] === undefined) return { path: index, purpose: 'inspect_dependency_exports' };
    const missing = reExportTargets(index, files[index] ?? '').find((t) => files[t] === undefined);
    return missing ? { path: missing, purpose: 'inspect_dependency_exports' } : null;
  }
  if (root.code === 'ERR_WORKSPACE_VERSION') {
    const dep = /Workspace dependency '(@[^@']+\/[^@']+)@/.exec(root.message)?.[1] ?? '';
    const target = workspaceByName(graph, dep);
    if (!target) return null;
    const manifest = `${target.path}/package.json`;
    return files[manifest] === undefined
      ? { path: manifest, purpose: 'inspect_dependency_manifest' }
      : null;
  }
  return null;
}

// ---------- candidates ----------

const lineAround = (text: string, needle: string): { line: number; text: string } | null => {
  const idx = text.split('\n').findIndex((l) => l.includes(needle));
  return idx === -1 ? null : { line: idx + 1, text: (text.split('\n')[idx] as string).trim() };
};

function dependencyEdit(
  manifest: string,
  module: string,
  version: string,
): { search: string; replace: string } | null {
  try {
    const pkg = JSON.parse(manifest) as { dependencies?: Record<string, string> };
    const deps = { ...(pkg.dependencies ?? {}), [module]: `^${version}` };
    const sorted = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
    const next = `${JSON.stringify({ ...pkg, dependencies: sorted }, null, 2)}\n`;
    return { search: manifest, replace: next };
  } catch {
    return null;
  }
}

/** Pure analysis: given the error and the files read so far, the candidate remedies with scores. */
export function analyseRemedy(
  root: LogError,
  files: FileMap,
  graph: WorkspaceGraph,
): RemedyAnalysis {
  const none: RemedyAnalysis = {
    candidates: [],
    confidence: 0,
    summary: `No remedy rule applies to ${root.code} in ${root.workspace}`,
    evidence: [],
  };
  const ws = workspaceByPath(graph, root.workspace);
  if (!ws) return none;
  const evidence: EvidenceDraft[] = [
    {
      source: `error:${root.workspace}`,
      text: `${root.code} ${root.message}${root.file ? ` at ${root.file}:${root.line}:${root.col}` : ''}`,
      tags: ['error'],
    },
  ];

  if (root.code === 'TS2307') {
    const module = /Cannot find module '([^']+)'/.exec(root.message)?.[1] ?? '';
    if (!module || workspaceByName(graph, module)) {
      return {
        ...none,
        summary: `'${module}' is a workspace package that failed to build; nothing to change in ${root.workspace}`,
      };
    }
    const lock = files['forge.lock.json'];
    const version = lock
      ? (JSON.parse(lock) as { catalog?: Record<string, string> }).catalog?.[module]
      : undefined;
    const manifest = files[`${ws.path}/package.json`];
    if (!version || !manifest)
      return { ...none, summary: `No pinned version for ${module} in forge.lock.json` };
    const edit = dependencyEdit(manifest, module, version);
    if (!edit) return none;
    evidence.push({
      source: 'lockfile',
      text: `forge.lock.json catalog: ${module}@${version}`,
      tags: ['lockfile'],
    });
    const remedy: Remedy = {
      kind: 'add_dependency',
      description: `Declare ${module}@^${version} in ${ws.path}/package.json (pinned in forge.lock.json)`,
      patch: { file: `${ws.path}/package.json`, edits: [edit] },
    };
    return {
      candidates: [
        {
          id: `add:${module}`,
          label: `add dependency ${module}@^${version}`,
          detail: remedy.description,
          payload: remedy,
          score: 0.95,
        },
      ],
      confidence: 0.95,
      summary: `Undeclared dependency ${module}; pinned version ${version} found in the lockfile`,
      evidence,
    };
  }

  if (root.code === 'ERR_WORKSPACE_VERSION') {
    const m =
      /Workspace dependency '(@[^@']+\/[^@']+)@([^']+)'.*local workspace version (\d+\.\d+\.\d+)/.exec(
        root.message,
      );
    const manifest = files[`${ws.path}/package.json`];
    if (!m || !manifest) return none;
    const [, dep, range, local] = m as unknown as [string, string, string, string];
    const search = `"${dep}": "${range}"`;
    if (!manifest.includes(search)) return none;
    const remedy: Remedy = {
      kind: 'fix_workspace_range',
      description: `Change ${dep} range in ${ws.path}/package.json from ${range} to ^${local} (the workspace's actual version)`,
      patch: {
        file: `${ws.path}/package.json`,
        edits: [{ search, replace: `"${dep}": "^${local}"` }],
      },
    };
    evidence.push({
      source: `workspace:${dep}`,
      text: `${dep} is version ${local} in this repository; requested range ${range}`,
      tags: ['version'],
    });
    return {
      candidates: [
        {
          id: `range:${dep}`,
          label: `use range ^${local} for ${dep}`,
          detail: remedy.description,
          payload: remedy,
          score: 0.95,
        },
      ],
      confidence: 0.95,
      summary: `Workspace range ${range} for ${dep} cannot be satisfied by local version ${local}`,
      evidence,
    };
  }

  if (root.code === 'TS2305') {
    const module = /Module '([^']+)'/.exec(root.message)?.[1] ?? '';
    const requested = /exported member '([^']+)'/.exec(root.message)?.[1] ?? '';
    const dep = workspaceByName(graph, module);
    if (!dep || !root.file || !requested) return none;
    const source = files[root.file];
    const indexFile = `${dep.path}/src/index.ts`;
    const index = files[indexFile];
    if (source === undefined || index === undefined) return none;
    const infos: ExportInfo[] = [
      ...exportsOf(indexFile, index),
      ...reExportTargets(indexFile, index).flatMap((t) => exportsOf(t, files[t] ?? '')),
    ];
    const ranked = infos
      .map((info) => ({ info, score: nameSimilarity(requested, info.name) }))
      .filter((c) => c.score >= 0.25)
      .sort((a, b) => b.score - a.score || a.info.name.localeCompare(b.info.name))
      .slice(0, 3);
    const callSite = lineAround(
      source
        .split('\n')
        .filter((l) => !/^\s*import\b/.test(l))
        .join('\n'),
      `${requested}(`,
    );
    const importLine = lineAround(source, requested);
    if (importLine)
      evidence.push({
        source: `import-site:${root.file}:${importLine.line}`,
        text: importLine.text,
        tags: ['import_site'],
      });
    if (callSite)
      evidence.push({ source: `call-site:${root.file}`, text: callSite.text, tags: ['call_site'] });
    for (const c of ranked) {
      evidence.push({
        source: `export:${c.info.name}`,
        text: `${c.info.doc ? `${c.info.doc}\n` : ''}${c.info.signature}`,
        tags: ['candidate_signature'],
      });
    }
    const candidates: Candidate[] = ranked.map((c) => {
      const remedy: Remedy = {
        kind: 'rename_import',
        description: `Replace the stale export name ${requested} with ${c.info.name} in ${root.file}`,
        patch: { file: root.file as string, edits: [{ search: requested, replace: c.info.name }] },
      };
      return {
        id: c.info.name,
        label: c.info.name,
        detail: `${c.info.signature} (name similarity ${c.score.toFixed(2)})`,
        payload: remedy,
        score: c.score,
      };
    });
    return {
      candidates,
      confidence: candidateConfidence(candidates.map((c) => c.score)),
      summary: candidates.length
        ? `'${requested}' is no longer exported by ${module}; ${candidates.length} candidate(s): ${candidates.map((c) => `${c.id} (${c.score.toFixed(2)})`).join(', ')}`
        : `'${requested}' is no longer exported by ${module} and no similar export exists`,
      evidence,
    };
  }
  return none;
}

// ---------- semantic judgement (stands in for a model's reasoning) ----------

const words = (s: string): string[] => splitCamel(s.replace(/[^A-Za-z0-9_$]+/g, ' '));

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Arguments of the first call to `name(` found in a source line. */
export function callArguments(line: string, name: string): string[] {
  const start = line.indexOf(`${name}(`);
  if (start === -1) return [];
  let depth = 0;
  for (let i = start + name.length; i < line.length; i += 1) {
    if (line[i] === '(') depth += 1;
    if (line[i] === ')') {
      depth -= 1;
      if (depth === 0) return splitTopLevel(line.slice(start + name.length + 1, i));
    }
  }
  return [];
}

export interface SemanticOption {
  id: string;
  signature: string;
  doc: string;
}

/**
 * Chooses the option whose parameters semantically fit the call site (arity, parameter names vs
 * argument names). This is what a reasoning model does with the minimum evidence.
 */
export function semanticChoice(
  callArgs: string[],
  options: SemanticOption[],
): { choiceId: string; rationale: string; confidence: number } | null {
  if (options.length === 0) return null;
  const scored = options.map((o) => {
    const params = parseParams(o.signature);
    const arity = params.length === callArgs.length ? 0.3 : 0;
    const overlap =
      params.length === 0
        ? 0
        : params.reduce((n, p, i) => {
            const a = new Set(words(callArgs[i] ?? ''));
            const b = words(p.name);
            return n + (b.length ? b.filter((w) => a.has(w)).length / b.length : 0);
          }, 0) / params.length;
    return { option: o, params, score: arity + 0.7 * overlap };
  });
  scored.sort((a, b) => b.score - a.score || a.option.id.localeCompare(b.option.id));
  const best = scored[0];
  const second = scored[1];
  if (!best) return null;
  const margin = best.score - (second?.score ?? 0);
  return {
    choiceId: best.option.id,
    rationale: `The call passes (${callArgs.join(', ')}); ${best.option.id}(${best.params.map((p) => p.name).join(', ')}) matches those arguments by name and arity.`,
    confidence: Math.round(Math.min(0.97, 0.55 + margin) * 100) / 100,
  };
}
