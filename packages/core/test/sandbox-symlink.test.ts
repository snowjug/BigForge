import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, SandboxViolation, diffManifests } from '../src/sandbox';

let base: string;
let root: string;
let outside: string;
let sandbox: Sandbox;
const violations: string[] = [];

async function rejection(promise: Promise<unknown>): Promise<SandboxViolation> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SandboxViolation) return err;
    throw err;
  }
  throw new Error('expected the sandbox to refuse the action');
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'bf-symlink-'));
  root = path.join(base, 'repo');
  outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(root, '.github/workflows/ci.yml'), 'name: ci\n');
  await writeFile(path.join(root, 'forge.lock.json'), '{}\n');
  // Links the agent could not create itself but a repository may already contain.
  await symlink('../.github/workflows/ci.yml', path.join(root, 'src/to-protected'));
  await symlink('../forge.lock.json', path.join(root, 'src/to-lock'));
  await symlink(path.join(outside, 'created-by-attacker.txt'), path.join(root, 'src/dangling'));
  await symlink(outside, path.join(root, 'src/to-outside-dir'));
  sandbox = new Sandbox({
    root,
    commandPolicy: { programs: {}, maxArgs: 8, maxArgLength: 200 },
    permissions: { read: ['**'], write: ['src/**'], commands: [] },
    onSafety: (r) => violations.push(r.rule),
  });
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('sandbox file access through symbolic links', () => {
  it('cannot overwrite a protected file through a link inside an allowed directory', async () => {
    const err = await rejection(sandbox.writeFile('src/to-protected', 'name: evil\n'));
    expect(['protected_path', 'symlink_write']).toContain(err.rule);
    expect(await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8')).toBe('name: ci\n');

    const lock = await rejection(sandbox.writeFile('src/to-lock', '{"evil":true}\n'));
    expect(['protected_path', 'symlink_write']).toContain(lock.rule);
    expect(await readFile(path.join(root, 'forge.lock.json'), 'utf8')).toBe('{}\n');
  });

  it('cannot create a file outside the root through a dangling link', async () => {
    const err = await rejection(sandbox.writeFile('src/dangling', 'pwned'));
    expect(['symlink_escape', 'symlink_write']).toContain(err.rule);
    expect(existsSync(path.join(outside, 'created-by-attacker.txt'))).toBe(false);
  });

  it('cannot reach outside the root through a linked directory', async () => {
    const err = await rejection(sandbox.writeFile('src/to-outside-dir/x.txt', 'pwned'));
    expect(err.rule).toBe('symlink_escape');
    expect(existsSync(path.join(outside, 'x.txt'))).toBe(false);
  });

  it('still reads and writes ordinary files', async () => {
    await sandbox.writeFile('src/b.ts', 'export const b = 2;\n');
    expect(await sandbox.readFile('src/b.ts')).toBe('export const b = 2;\n');
    expect(await sandbox.readFile('src/a.ts')).toContain('a = 1');
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('change manifests', () => {
  it('records a file named after an Object.prototype member like any other file', async () => {
    const before = await sandbox.snapshot();
    await writeFile(path.join(root, 'src/__proto__'), 'x');
    await writeFile(path.join(root, 'src/constructor'), 'x');
    await writeFile(path.join(root, 'toString'), 'x');
    const after = await sandbox.snapshot();
    const diff = diffManifests(before, after);
    expect(diff.added).toEqual(
      expect.arrayContaining(['src/__proto__', 'src/constructor', 'toString']),
    );
    expect(diff.modified).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('shows a newly created or retargeted link as a change', async () => {
    const before = await sandbox.snapshot();
    await symlink('a.ts', path.join(root, 'src/alias'));
    const after = await sandbox.snapshot();
    expect(diffManifests(before, after).added).toContain('src/alias');
    expect(before['src/to-protected']).toBe('symlink:../.github/workflows/ci.yml');
  });
});
