import { realpath } from 'node:fs/promises';
import path from 'node:path';

export class PathViolationError extends Error {
  readonly rule: string;
  constructor(rule: string, message: string) {
    super(message);
    this.name = 'PathViolationError';
    this.rule = rule;
  }
}

/**
 * Resolves `rel` inside `root` purely lexically. Rejects absolute paths, NUL bytes,
 * drive prefixes and any `..` segment that escapes the root.
 */
export function resolveInside(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new PathViolationError('empty_path', 'Path must be a non-empty string');
  }
  if (rel.length > 400) throw new PathViolationError('path_too_long', 'Path is too long');
  if (rel.includes('\0')) throw new PathViolationError('nul_byte', 'Path contains a NUL byte');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\')) {
    throw new PathViolationError('absolute_path', `Absolute paths are not allowed: ${rel}`);
  }
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, rel);
  const relative = path.relative(absRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PathViolationError('path_traversal', `Path escapes the working directory: ${rel}`);
  }
  return resolved;
}

/** Like resolveInside, and additionally rejects symlinks that resolve outside the root. */
export async function resolveInsideReal(root: string, rel: string): Promise<string> {
  const resolved = resolveInside(root, rel);
  const absRoot = await realpath(path.resolve(root));
  let real: string;
  try {
    real = await realpath(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Not yet created (writes): check the nearest existing parent instead.
      real = path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
    } else {
      throw err;
    }
  }
  const relative = path.relative(absRoot, real);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PathViolationError('symlink_escape', `Path resolves outside the root: ${rel}`);
  }
  return resolved;
}

export function toPosixRelative(root: string, absolute: string): string {
  return path.relative(path.resolve(root), absolute).split(path.sep).join('/');
}

const globCache = new Map<string, RegExp>();

/** Minimal glob: `**` spans directories, `*` and `?` do not. No other metacharacters. */
export function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) return cached;
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i] as string;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const compiled = new RegExp(`^${re}$`);
  globCache.set(pattern, compiled);
  return compiled;
}

export function matchesAnyGlob(patterns: readonly string[], posixPath: string): boolean {
  return patterns.some((p) => globToRegExp(p).test(posixPath));
}
