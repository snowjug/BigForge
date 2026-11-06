// Development runner: API (tsx watch) + web (Vite) with prefixed logs. Ctrl-C stops both.
import { spawn } from 'node:child_process';

const children = [];
const prefix = (name, color) => (chunk) => {
  for (const line of String(chunk).split('\n')) {
    if (line.trim()) process.stdout.write(`\x1b[${color}m[${name}]\x1b[0m ${line}\n`);
  }
};

function run(name, color, command, args, env = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  child.stdout.on('data', prefix(name, color));
  child.stderr.on('data', prefix(name, color));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stdout.write(`[${name}] exited with code ${code}\n`);
      shutdown(code);
    }
  });
  children.push(child);
}

function shutdown(code = 0) {
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const port = process.env.PORT ?? '4747';
run('api', 36, 'npx', ['tsx', 'watch', '--clear-screen=false', 'apps/api/src/main.ts'], { PORT: port, HOST: '127.0.0.1' });
run('web', 35, 'npx', ['vite', '--config', 'apps/web/vite.config.ts', 'apps/web'], { BIGFORGE_API_PORT: port });
process.stdout.write(`BigForge dev: API http://127.0.0.1:${port}  ·  web http://127.0.0.1:5173\n`);
