#!/usr/bin/env node
// @ts-check
/**
 * forge-ci: the toolchain of the BigForge synthetic monorepo lab.
 *
 * A small, deterministic build tool that statically "builds" a JavaScript monorepo
 * (imports, exports, declared dependencies, workspace version ranges) and prints a
 * realistic, noisy build log. It performs no network access and has no side effects.
 *
 * Usage: forge-ci build [--workspace <path>] [--verbose]
 *        forge-ci test  [--workspace <path>]
 *        forge-ci graph --json
 *
 * Behaviour is driven by forge.config.json in the working directory:
 *   1.4.x  builds workspaces sequentially in dependency order
 *   1.5.x  builds workspaces in parallel; log lines are emitted by completion time
 * The grammar of a log line is identical in both versions; only ordering and banner change.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** @param {string} s */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** @param {string} rel */
function readText(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** @param {string} rel */
function readJson(rel) {
  return JSON.parse(readText(rel));
}

/** @param {string[]} argv */
function parseFlags(argv) {
  const flags = {
    workspace: /** @type {string | null} */ (null),
    json: false,
    verbose: false,
    rest: /** @type {string[]} */ ([]),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = /** @type {string} */ (argv[i]);
    if (a === '--json') flags.json = true;
    else if (a === '--verbose') flags.verbose = true;
    else if (a === '--workspace') flags.workspace = argv[(i += 1)] ?? null;
    else if (a.startsWith('--workspace=')) flags.workspace = a.slice('--workspace='.length);
    else flags.rest.push(a);
  }
  return flags;
}

function loadConfig() {
  const cfg = readJson('forge.config.json');
  return {
    version: String(cfg.toolchain?.version ?? '1.4.2'),
    seed: Number(cfg.buildSeed ?? 1),
    registry: String(cfg.registry ?? ''),
    token: String(cfg.registryToken ?? ''),
  };
}

/** @typedef {{ path: string, name: string, version: string, deps: Record<string,string>, devDeps: Record<string,string>, pkgText: string }} Workspace */

/** @returns {Workspace[]} */
function loadWorkspaces() {
  const rootPkg = readJson('package.json');
  /** @type {Workspace[]} */
  const out = [];
  for (const pattern of /** @type {string[]} */ (rootPkg.workspaces ?? [])) {
    if (!pattern.endsWith('/*')) continue;
    const base = pattern.slice(0, -2);
    const dir = path.join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      const rel = `${base}/${entry}`;
      if (!existsSync(path.join(ROOT, rel, 'package.json'))) continue;
      const pkgText = readText(`${rel}/package.json`);
      const pkg = JSON.parse(pkgText);
      out.push({
        path: rel,
        name: pkg.name,
        version: pkg.version,
        deps: pkg.dependencies ?? {},
        devDeps: pkg.devDependencies ?? {},
        pkgText,
      });
    }
  }
  return out;
}

/** @param {string} range @param {string} version */
function satisfies(range, version) {
  const parse = (/** @type {string} */ v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [vM = 0, vm = 0, vp = 0] = parse(version);
  if (range === '*' || range === 'workspace:*') return true;
  const m = /^([\^~]?)(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) return false;
  const [, op, rM, rm, rp] = m.map((x, i) => (i === 0 || i === 1 ? x : Number(x)));
  const R = /** @type {number} */ (rM);
  const Mn = /** @type {number} */ (rm);
  const P = /** @type {number} */ (rp);
  const ge = vM > R || (vM === R && (vm > Mn || (vm === Mn && vp >= P)));
  if (!ge) return false;
  if (op === '^') return R > 0 ? vM === R : vm === Mn;
  if (op === '~') return vM === R && vm === Mn;
  return vM === R && vm === Mn && vp === P;
}

/** @param {Workspace[]} workspaces */
function buildGraph(workspaces) {
  const byName = new Map(workspaces.map((w) => [w.name, w]));
  /** @type {Map<string, string[]>} */
  const deps = new Map();
  for (const w of workspaces) {
    const names = Object.keys({ ...w.deps, ...w.devDeps }).filter((n) => byName.has(n));
    deps.set(w.name, names.sort());
  }
  /** @type {Map<string, number>} */
  const level = new Map();
  /** @param {string} name @returns {number} */
  const levelOf = (name) => {
    const cached = level.get(name);
    if (cached !== undefined) return cached;
    const l = 1 + Math.max(-1, ...(deps.get(name) ?? []).map(levelOf));
    level.set(name, l);
    return l;
  };
  for (const w of workspaces) levelOf(w.name);
  const order = [...workspaces].sort(
    (a, b) => (level.get(a.name) ?? 0) - (level.get(b.name) ?? 0) || a.path.localeCompare(b.path),
  );
  return { byName, deps, level, order };
}

/** @param {Workspace} ws @param {string} sub */
function listSources(ws, sub = 'src') {
  const dir = path.join(ROOT, ws.path, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => `${ws.path}/${sub}/${f}`);
}

/** @param {string} fileRel @param {Set<string>} seen @returns {Set<string>} */
function collectExports(fileRel, seen = new Set()) {
  const names = new Set();
  if (seen.has(fileRel) || seen.size > 12) return names;
  seen.add(fileRel);
  if (!existsSync(path.join(ROOT, fileRel))) return names;
  for (const line of readText(fileRel).split('\n')) {
    let m =
      /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(
        line,
      );
    if (m) {
      names.add(/** @type {string} */ (m[1]));
      continue;
    }
    m = /^export\s*\{([^}]*)\}/.exec(line);
    if (m) {
      for (const part of /** @type {string} */ (m[1]).split(',')) {
        const piece = part.trim().replace(/^type\s+/, '');
        if (!piece) continue;
        const asMatch = /\sas\s+([A-Za-z_$][\w$]*)$/.exec(piece);
        names.add(asMatch ? /** @type {string} */ (asMatch[1]) : piece);
      }
      continue;
    }
    m = /^export\s*\*\s*from\s*['"]([^'"]+)['"]/.exec(line);
    if (m && /** @type {string} */ (m[1]).startsWith('./')) {
      const base = path.posix.join(path.posix.dirname(fileRel), /** @type {string} */ (m[1]));
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) {
        for (const n of collectExports(cand, seen)) names.add(n);
      }
    }
  }
  return names;
}

/** @param {string} line */
function parseImport(line) {
  const m = /^\s*import\s+(?:type\s+)?(?:(.+?)\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/.exec(line);
  if (!m) return null;
  const clause = m[1] ?? '';
  const named = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) {
    for (const part of /** @type {string} */ (braces[1]).split(',')) {
      const piece = part.trim().replace(/^type\s+/, '');
      if (!piece) continue;
      named.push(piece.split(/\s+as\s+/)[0]);
    }
  }
  return { spec: /** @type {string} */ (m[2]), named: /** @type {string[]} */ (named) };
}

/**
 * @typedef {{ code: string, message: string, file: string, line: number, col: number, workspace: string, cascade: boolean }} Diagnostic
 */

/** @param {string} text @param {string} needle */
function lineOf(text, needle) {
  const idx = text.split('\n').findIndex((l) => l.includes(needle));
  return idx === -1 ? 1 : idx + 1;
}

/**
 * @param {Workspace} ws
 * @param {ReturnType<typeof buildGraph>} graph
 * @param {Set<string>} failed names of workspaces that already failed (topological order)
 * @returns {{ errors: Diagnostic[], resolutions: string[] }}
 */
function analyze(ws, graph, failed) {
  /** @type {Diagnostic[]} */
  const errors = [];
  /** @type {string[]} */
  const resolutions = [];
  const declared = { ...ws.deps, ...ws.devDeps };

  for (const [dep, range] of Object.entries(declared)) {
    const target = graph.byName.get(dep);
    if (!target) continue;
    const ok = satisfies(range, target.version);
    resolutions.push(
      `dependency ${dep}@${range} -> ${target.path}@${target.version} ${ok ? 'ok' : 'NOT SATISFIED'}`,
    );
    if (!ok) {
      errors.push({
        code: 'ERR_WORKSPACE_VERSION',
        message: `Workspace dependency '${dep}@${range}' of ${ws.name} is not satisfied by local workspace version ${target.version}.`,
        file: `${ws.path}/package.json`,
        line: lineOf(ws.pkgText, `"${dep}"`),
        col: 5,
        workspace: ws.path,
        cascade: false,
      });
    }
  }

  for (const file of listSources(ws)) {
    const lines = readText(file).split('\n');
    lines.forEach((text, i) => {
      const imp = parseImport(text);
      if (!imp) return;
      const { spec, named } = imp;
      const col = text.indexOf(spec) + 1;
      const at = { file, line: i + 1, col, workspace: ws.path };
      if (spec.startsWith('node:')) return;
      if (spec.startsWith('.')) {
        const base = path.posix.join(path.posix.dirname(file), spec);
        const found = [`${base}.ts`, `${base}/index.ts`].some((c) =>
          existsSync(path.join(ROOT, c)),
        );
        if (!found) {
          errors.push({
            ...at,
            code: 'TS2307',
            message: `Cannot find module '${spec}' or its corresponding type declarations.`,
            cascade: false,
          });
        }
        return;
      }
      const target = graph.byName.get(spec);
      if (target) {
        if (!(spec in declared)) {
          errors.push({
            ...at,
            code: 'TS2307',
            message: `Cannot find module '${spec}' or its corresponding type declarations.`,
            cascade: false,
          });
          return;
        }
        if (failed.has(spec)) {
          resolutions.push(
            `import '${spec}' at ${file}:${i + 1} -> ${target.path} (build failed, no declarations)`,
          );
          errors.push({
            ...at,
            code: 'TS2307',
            message: `Cannot find module '${spec}' or its corresponding type declarations.`,
            cascade: true,
          });
          return;
        }
        const exported = collectExports(`${target.path}/src/index.ts`);
        resolutions.push(
          `import '${spec}' at ${file}:${i + 1} -> ${target.path} exports [${[...exported].sort().join(', ')}]`,
        );
        for (const n of named) {
          if (!exported.has(n)) {
            errors.push({
              ...at,
              code: 'TS2305',
              message: `Module '${spec}' has no exported member '${n}'.`,
              cascade: false,
            });
          }
        }
        return;
      }
      if (!(spec in declared)) {
        errors.push({
          ...at,
          code: 'TS2307',
          message: `Cannot find module '${spec}' or its corresponding type declarations.`,
          cascade: false,
        });
        resolutions.push(
          `import '${spec}' at ${file}:${i + 1} -> NOT DECLARED in ${ws.path}/package.json (declared: ${Object.keys(declared).sort().join(', ') || 'none'})`,
        );
      } else {
        resolutions.push(`import '${spec}' at ${file}:${i + 1} -> declared ${declared[spec]}`);
      }
    });
  }
  return { errors, resolutions };
}

const NOISE = [
  (/** @type {string} */ n) => `warn peer dependency react@^18 required by ${n} (found 19.0.0)`,
  () => 'warn deprecated: left-pad@1.3.0 is no longer maintained',
  (/** @type {string} */ n) => `warn unused dependency in ${n}: lodash (declared, never imported)`,
  () => "warn TS6133: 'tmp' is declared but its value is never read.",
  () => 'warn cache miss for incremental build info (.forge/cache)',
  () => 'warn source map generation is slow for large inputs',
  (/** @type {string} */ n) => `warn ${n}: sideEffects flag missing in package.json`,
];

/** @param {number} ms */
function stamp(ms) {
  const total = Math.max(0, Math.round(ms));
  const s = Math.floor(total / 1000);
  return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}]`;
}

/**
 * @typedef {{ t: number, ws: string, text: string, order: number }} LogEvent
 */

/**
 * @param {Workspace[]} targets workspaces to build (already includes dependencies)
 * @param {ReturnType<typeof buildGraph>} graph
 * @param {ReturnType<typeof loadConfig>} cfg
 */
function runBuild(targets, graph, cfg) {
  const parallel = !cfg.version.startsWith('1.4');
  /** @type {Set<string>} */
  const failed = new Set();
  /** @type {Map<string, { errors: Diagnostic[], resolutions: string[] }>} */
  const results = new Map();
  for (const ws of targets) {
    const r = analyze(ws, graph, failed);
    results.set(ws.path, r);
    if (r.errors.length > 0) failed.add(ws.name);
  }

  /** @type {LogEvent[]} */
  const events = [];
  let order = 0;
  const push = (/** @type {number} */ t, /** @type {string} */ ws, /** @type {string} */ text) => {
    events.push({ t, ws, text, order: (order += 1) });
  };
  const line = (/** @type {string} */ ws, /** @type {string} */ glyph, /** @type {string} */ msg) =>
    `${ws.padEnd(20)} ${glyph} ${msg}`;

  let clock = 0;
  for (const ws of targets) {
    const r = /** @type {{ errors: Diagnostic[], resolutions: string[] }} */ (results.get(ws.path));
    const h = hash(`${ws.path}:${cfg.seed}`);
    const dur = 12 + (h % 30);
    const start = parallel ? h % 3 : clock;
    push(start, ws.path, line(ws.path, '\u25B8', 'build start'));
    const noiseCount = 1 + ((h >>> 3) % 3);
    for (let k = 0; k < noiseCount; k += 1) {
      const fn = /** @type {(n: string) => string} */ (NOISE[(h + k * 3) % NOISE.length]);
      push(start + 2 + k * 3, ws.path, line(ws.path, '\u26A0', fn(ws.name)));
    }
    for (const file of listSources(ws)) {
      push(
        start + 3 + (hash(file) % 6),
        ws.path,
        line(
          ws.path,
          '\u25B8',
          `compiled ${file} (${(0.4 + (hash(file) % 20) / 10).toFixed(1)}ms)`,
        ),
      );
    }
    const rootFailT = 5 + (h % 28);
    const resolveFailT = 10 + (h % 34);
    r.errors.forEach((e, idx) => {
      const base = e.cascade ? resolveFailT : rootFailT;
      const t = parallel ? start + base + idx : start + Math.round(dur * 0.7) + idx;
      push(
        t,
        ws.path,
        `${line(ws.path, '\u2716', `error ${e.code}: ${e.message}`)}\n${' '.repeat(35)}at ${e.file}:${e.line}:${e.col}`,
      );
    });
    const lastT = Math.max(start + dur, ...events.filter((e) => e.ws === ws.path).map((e) => e.t));
    if (r.errors.length > 0) {
      push(
        lastT + 1,
        ws.path,
        line(
          ws.path,
          '\u2716',
          `build failed (${r.errors.length} error${r.errors.length === 1 ? '' : 's'})`,
        ),
      );
    } else {
      push(lastT + 1, ws.path, line(ws.path, '\u2714', `built in ${dur}ms`));
    }
    clock = start + dur + 1;
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const totalErrors = [...results.values()].reduce((n, r) => n + r.errors.length, 0);
  const failedCount = [...results.values()].filter((r) => r.errors.length > 0).length;
  return { events, results, totalErrors, failedCount, failed, parallel };
}

function banner(cfg, count, parallel) {
  const lines = [
    `forge-ci ${cfg.version} \u00B7 node ${process.version} \u00B7 acme-platform`,
    `\u25B8 config   forge.config.json  registry=${cfg.registry}`,
    `\u25B8 env      CI=true FORGE_REGISTRY_TOKEN=${cfg.token}`,
    `\u25B8 plan     ${count} workspaces \u00B7 mode=${parallel ? 'parallel (concurrency=4)' : 'sequential (dependency order)'}`,
  ];
  return lines;
}

/** @param {Workspace[]} all @param {ReturnType<typeof buildGraph>} graph @param {string | null} target */
function selectTargets(all, graph, target) {
  if (!target) return graph.order;
  const root = all.find((w) => w.path === target);
  if (!root) return null;
  /** @type {Set<string>} */
  const wanted = new Set();
  /** @param {string} name */
  const visit = (name) => {
    if (wanted.has(name)) return;
    wanted.add(name);
    for (const d of graph.deps.get(name) ?? []) visit(d);
  };
  visit(root.name);
  return graph.order.filter((w) => wanted.has(w.name));
}

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (!sub || !['build', 'test', 'graph'].includes(sub)) {
    console.error('usage: forge-ci <build|test|graph> [--workspace <path>] [--verbose] [--json]');
    return 2;
  }
  if (!existsSync(path.join(ROOT, 'forge.config.json'))) {
    console.error('forge-ci: forge.config.json not found in the working directory');
    return 2;
  }
  const cfg = loadConfig();
  const all = loadWorkspaces();
  const graph = buildGraph(all);

  if (sub === 'graph') {
    const doc = {
      workspaces: graph.order.map((w) => ({
        name: w.name,
        path: w.path,
        version: w.version,
        dependsOn: graph.deps.get(w.name) ?? [],
        dependents: all
          .filter((o) => (graph.deps.get(o.name) ?? []).includes(w.name))
          .map((o) => o.name)
          .sort(),
        level: graph.level.get(w.name) ?? 0,
      })),
      order: graph.order.map((w) => w.path),
    };
    console.log(flags.json ? JSON.stringify(doc, null, 2) : doc.order.join('\n'));
    return 0;
  }

  const targets = selectTargets(all, graph, flags.workspace);
  if (!targets) {
    console.error(`forge-ci: workspace not found: ${flags.workspace}`);
    return 2;
  }

  const run = runBuild(targets, graph, cfg);
  const out = banner(cfg, targets.length, run.parallel);
  for (const e of run.events) out.push(`${stamp(e.t)} ${e.text}`);

  if (sub === 'build') {
    if (flags.verbose && flags.workspace) {
      const r = run.results.get(flags.workspace);
      out.push('', `\u25B8 diagnostic ${flags.workspace}`);
      const ws = /** @type {Workspace} */ (all.find((w) => w.path === flags.workspace));
      out.push(`  package.json name=${ws.name} version=${ws.version}`);
      out.push(
        `  dependencies: ${
          Object.entries(ws.deps)
            .map(([k, v]) => `${k}@${v}`)
            .join(', ') || 'none'
        }`,
      );
      for (const res of r?.resolutions ?? []) out.push(`  ${res}`);
      for (const e of r?.errors ?? [])
        out.push(`  ${e.code} ${e.file}:${e.line}:${e.col} ${e.message}`);
      const lock = existsSync(path.join(ROOT, 'forge.lock.json'))
        ? readJson('forge.lock.json')
        : { catalog: {} };
      for (const e of r?.errors ?? []) {
        const m = /Cannot find module '([^']+)'/.exec(e.message);
        if (m && lock.catalog?.[/** @type {string} */ (m[1])]) {
          out.push(
            `  catalog: ${m[1]}@${lock.catalog[/** @type {string} */ (m[1])]} is available in forge.lock.json`,
          );
        }
      }
    }
    out.push('');
    const built = targets.length - run.failedCount;
    out.push(
      run.totalErrors > 0
        ? `\u2716 build failed \u00B7 ${run.failedCount} failed \u00B7 ${built} built \u00B7 ${run.totalErrors} errors`
        : `\u2714 build passed \u00B7 ${built} built \u00B7 0 errors`,
    );
    console.log(out.join('\n'));
    return run.totalErrors > 0 ? 1 : 0;
  }

  // test
  let failedTests = 0;
  let passedTotal = 0;
  const testOut = [];
  for (const ws of targets) {
    if (flags.workspace && ws.path !== flags.workspace) continue;
    const blocked = run.results.get(ws.path)?.errors.length ?? 0;
    const upstream = (graph.deps.get(ws.name) ?? []).filter((d) => run.failed.has(d));
    if (blocked > 0 || upstream.length > 0) {
      failedTests += 1;
      testOut.push(
        `\u25B8 test ${ws.path}  \u2716 cannot run: build failed${upstream.length ? ` in ${upstream.join(', ')}` : ''}`,
      );
      continue;
    }
    const files = listSources(ws).filter((f) => f.endsWith('.test.ts'));
    const sources = listSources(ws).filter((f) => !f.endsWith('.test.ts'));
    let count = 0;
    /** @type {string[]} */
    const failures = [];
    for (const f of files) {
      const text = readText(f);
      const its = text.match(/^\s*it\(/gm)?.length ?? 0;
      const expected = [...text.matchAll(/@expect-call\s+([A-Za-z_$][\w$]*)/g)].map(
        (m) => /** @type {string} */ (m[1]),
      );
      const missing = expected.filter(
        (name) => !sources.some((s) => new RegExp(`\\b${name}\\(`).test(readText(s))),
      );
      if (missing.length > 0)
        failures.push(`${f}: expected a call to ${missing.join(', ')} in ${ws.path}/src`);
      else count += its;
    }
    if (failures.length > 0) {
      failedTests += 1;
      testOut.push(`\u25B8 test ${ws.path}  \u2716 ${failures.length} failed`);
      for (const f of failures) testOut.push(`    ${f}`);
      continue;
    }
    passedTotal += count;
    testOut.push(
      `\u25B8 test ${ws.path}  \u2714 ${count} passed (${files.length} file${files.length === 1 ? '' : 's'})`,
    );
  }
  console.log(
    [
      ...banner(cfg, targets.length, run.parallel),
      ...testOut,
      '',
      failedTests > 0
        ? `\u2716 tests failed \u00B7 ${failedTests} workspace(s) could not run`
        : `\u2714 tests passed \u00B7 ${passedTotal} passed`,
    ].join('\n'),
  );
  return failedTests > 0 ? 1 : 0;
}

process.exitCode = main();
