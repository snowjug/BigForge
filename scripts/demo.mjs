// One-command demo launcher: builds if needed, then starts the production server.
//   npm run demo            -> build (if missing) + start on http://127.0.0.1:4747
//   npm run demo -- --dev   -> start the development stack (API + Vite) instead
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const port = process.env.PORT ?? '4747';
const dev = process.argv.includes('--dev');

// The server uses the built-in node:sqlite; older Node versions fail later with an obscure error.
const nodeMajor = Number.parseInt(process.versions.node, 10);
if (nodeMajor < 24) {
  console.error(
    `BigForge needs Node.js 24 or newer (it uses the built-in node:sqlite); this is Node.js ${process.versions.node}.`,
  );
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(path.join(root, 'node_modules'))) {
  console.log('Installing dependencies (npm ci)...');
  run('npm', ['ci', '--no-audit', '--no-fund']);
}

if (dev) {
  run('node', ['scripts/dev.mjs']);
} else {
  const bundle = path.join(root, 'dist/server/main.mjs');
  const stale =
    !existsSync(bundle) ||
    statSync(bundle).mtimeMs < statSync(path.join(root, 'package.json')).mtimeMs;
  if (stale) {
    console.log('Building BigForge (web + server)...');
    run('npm', ['run', 'build']);
  }
  const serverDir = path.join(root, 'dist/server');
  if (!existsSync(path.join(serverDir, 'node_modules'))) {
    console.log('Installing server runtime dependencies...');
    run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: serverDir });
  }
  const child = spawn('node', ['main.mjs'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      HOST: process.env.HOST ?? '127.0.0.1',
      BIGFORGE_DATA_DIR: process.env.BIGFORGE_DATA_DIR ?? path.join(root, '.bigforge'),
    },
  });
  console.log(
    `\nBigForge demo: http://127.0.0.1:${port}\n  sign in as Grace (reviewer): grace@acme.test / forge-demo\n  then choose "Start guided demo" on the Forge Floor.\n  The demo runs fully offline with a deterministic provider (synthetic tokens).\n`,
  );
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}
