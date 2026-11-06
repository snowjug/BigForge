// Production build of the server: bundles the API, application layer and engine into dist/server
// (third-party packages stay external), copies the lab tool and the built web app next to it.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist/server');
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Third-party runtime dependencies (workspace packages are bundled, not listed).
const manifests = [
  'apps/api/package.json',
  'apps/worker/package.json',
  'packages/platform/package.json',
  'packages/core/package.json',
  'packages/security/package.json',
  'packages/providers/package.json',
  'packages/schemas/package.json',
  'packages/observability/package.json',
  'synthetic-labs/monorepo-build/package.json',
];
const deps = {};
for (const m of manifests) {
  for (const [name, version] of Object.entries(read(m).dependencies ?? {})) {
    if (!name.startsWith('@bigforge/')) deps[name] = version;
  }
}
const external = [...Object.keys(deps), '@azure/identity', '@azure/monitor-opentelemetry'];

await build({
  entryPoints: {
    main: path.join(root, 'apps/api/src/main.ts'),
    worker: path.join(root, 'apps/worker/src/main.ts'),
  },
  outdir: out,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __bfCreateRequire } from 'node:module';\nconst require = __bfCreateRequire(import.meta.url);",
  },
});

cpSync(
  path.join(root, 'synthetic-labs/monorepo-build/src/tool/forge-ci.mjs'),
  path.join(out, 'forge-ci.mjs'),
);
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify({ name: 'bigforge-server', version: read('package.json').version, private: true, type: 'module', engines: { node: '>=24' }, dependencies: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`,
);

const webDist = path.join(root, 'apps/web/dist');
if (existsSync(webDist)) cpSync(webDist, path.join(root, 'dist/web'), { recursive: true });
else
  console.warn(
    'apps/web/dist not found: run `npm run build:web` first; the server will serve the API only.',
  );
console.log(`Server bundle ready in ${path.relative(root, out)}`);
