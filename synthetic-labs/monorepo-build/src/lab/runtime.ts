import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandPolicy } from '@bigforge/security';
import { existsSync } from 'node:fs';
import type { RepoFiles } from './generator';

/** Writes repository files under `root`. Paths are generator-controlled, never user input. */
export async function writeRepo(root: string, files: RepoFiles): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, text, 'utf8');
  }
}

/**
 * Locates the forge-ci tool script. Works from source (dev/test) and from the server bundle
 * (the build copies the script next to the bundle).
 */
export function resolveForgeCiPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.BIGFORGE_FORGE_CI,
    path.join(here, 'forge-ci.mjs'),
    path.join(here, '../tool/forge-ci.mjs'),
    path.join(here, 'tool/forge-ci.mjs'),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`forge-ci tool not found. Looked in: ${candidates.join(', ')}`);
  return found;
}

/** The only program the lab exposes to agents and Reflexes. Structured args, no shell. */
export function forgeCiPolicy(toolPath: string = resolveForgeCiPath()): CommandPolicy {
  const workspace = { type: 'path' as const, maxLength: 120 };
  return {
    maxArgs: 8,
    maxArgLength: 160,
    programs: {
      'forge-ci': {
        argvPrefix: [process.execPath, '--max-old-space-size=128', toolPath],
        subcommands: {
          build: { flags: { '--workspace': workspace, '--verbose': { type: 'bool' } } },
          test: { flags: { '--workspace': workspace } },
          graph: { flags: { '--json': { type: 'bool' } } },
        },
      },
    },
  };
}
