export interface LogError {
  workspace: string;
  code: string;
  message: string;
  file: string | null;
  line: number | null;
  col: number | null;
  /** Position of the error among error lines, in log order (0 = first). */
  index: number;
}

export interface ParsedLog {
  toolchain: { name: string; version: string } | null;
  mode: 'sequential' | 'parallel' | 'unknown';
  errors: LogError[];
  failedWorkspaces: string[];
  builtWorkspaces: string[];
  lineCount: number;
  warningCount: number;
}

// eslint-disable-next-line no-control-regex -- matching ANSI escape sequences requires the ESC control character
const ANSI = /\u001b\[[0-9;]*m/g;
const EVENT = /^\[(\d\d:\d\d\.\d{3})\]\s+(\S+)\s+(\u2716|\u2714|\u26A0|\u25B8)\s+(.*)$/;
const AT = /^\s+at\s+(\S+?):(\d+):(\d+)\s*$/;
const ERROR = /^error\s+(TS\d+|ERR_[A-Z_]+):\s+(.*)$/;

/**
 * Tolerant parser for forge-ci build logs. Understands every version's line grammar
 * (1.4 sequential and 1.5 parallel share one grammar; only ordering differs).
 */
export function parseBuildLog(raw: string): ParsedLog {
  const text = raw.replace(ANSI, '');
  const lines = text.split('\n');
  const errors: LogError[] = [];
  const failed = new Set<string>();
  const built = new Set<string>();
  let warnings = 0;
  let toolchain: ParsedLog['toolchain'] = null;
  let mode: ParsedLog['mode'] = 'unknown';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const banner = /^forge-ci\s+(\d+\.\d+\.\d+)/.exec(line);
    if (banner) toolchain = { name: 'forge-ci', version: banner[1] as string };
    const plan = /mode=(sequential|parallel)/.exec(line);
    if (plan) mode = plan[1] as 'sequential' | 'parallel';
    const m = EVENT.exec(line);
    if (!m) continue;
    const [, , workspace, glyph, rest] = m as unknown as [string, string, string, string, string];
    if (glyph === '\u26A0') warnings += 1;
    if (glyph === '\u2714' && /^built in/.test(rest)) built.add(workspace);
    if (glyph === '\u2716' && /^build failed/.test(rest)) failed.add(workspace);
    if (glyph === '\u2716') {
      const e = ERROR.exec(rest);
      if (e) {
        const at = AT.exec(lines[i + 1] ?? '');
        errors.push({
          workspace,
          code: e[1] as string,
          message: e[2] as string,
          file: at ? (at[1] as string) : null,
          line: at ? Number(at[2]) : null,
          col: at ? Number(at[3]) : null,
          index: errors.length,
        });
      }
    }
  }
  return {
    toolchain,
    mode,
    errors,
    failedWorkspaces: [...failed],
    builtWorkspaces: [...built],
    lineCount: lines.length,
    warningCount: warnings,
  };
}

/** Compact, order-preserving digest of the signal in a build log (no timestamps, noise or secrets). */
export function normalizeLog(raw: string): string {
  const parsed = parseBuildLog(raw);
  const out: string[] = [];
  if (parsed.toolchain)
    out.push(`toolchain ${parsed.toolchain.name} ${parsed.toolchain.version} (${parsed.mode})`);
  for (const e of parsed.errors) {
    out.push(
      `error ${e.code} in ${e.workspace}: ${e.message}${e.file ? ` [${e.file}:${e.line}:${e.col}]` : ''}`,
    );
  }
  out.push(`failed: ${parsed.failedWorkspaces.join(', ') || 'none'}`);
  out.push(`built: ${parsed.builtWorkspaces.join(', ') || 'none'}`);
  return out.join('\n');
}

export interface GraphWorkspace {
  name: string;
  path: string;
  version: string;
  dependsOn: string[];
  dependents: string[];
  level: number;
}

export interface WorkspaceGraph {
  workspaces: GraphWorkspace[];
  order: string[];
}

export function parseGraph(raw: string): WorkspaceGraph {
  const doc = JSON.parse(raw) as WorkspaceGraph;
  if (!Array.isArray(doc.workspaces) || !Array.isArray(doc.order))
    throw new Error('Unexpected graph output');
  return doc;
}

export function workspaceByName(graph: WorkspaceGraph, name: string): GraphWorkspace | undefined {
  return graph.workspaces.find((w) => w.name === name);
}

export function workspaceByPath(graph: WorkspaceGraph, path: string): GraphWorkspace | undefined {
  return graph.workspaces.find((w) => w.path === path);
}

export type RootLocator = 'log_order' | 'dependency_graph';

/**
 * Finds the root cause: the error that is not merely a consequence of another workspace failing.
 * - log_order: the first error line in the log (cheap; assumes dependency-ordered output).
 * - dependency_graph: an error in a workspace none of whose dependencies also failed.
 */
export function locateRoot(
  errors: LogError[],
  graph: WorkspaceGraph | null,
  how: RootLocator,
): LogError | null {
  if (errors.length === 0) return null;
  if (how === 'log_order' || !graph) return errors[0] ?? null;
  const failing = new Set(errors.map((e) => e.workspace));
  const byPath = new Map(graph.workspaces.map((w) => [w.path, w]));
  const nameToPath = new Map(graph.workspaces.map((w) => [w.name, w.path]));
  const roots = errors.filter((e) => {
    const ws = byPath.get(e.workspace);
    if (!ws) return true;
    return !ws.dependsOn.some((dep) => {
      const depPath = nameToPath.get(dep);
      return depPath !== undefined && failing.has(depPath);
    });
  });
  return roots[0] ?? errors[0] ?? null;
}
