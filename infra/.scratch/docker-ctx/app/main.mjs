import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.env.PORT ?? 4747);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = process.env.BIGFORGE_DATA_DIR ?? './.bigforge';

mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'probe.txt'), 'writable');

// Prove the runtime dependency installed inside dist/server resolves.
const { z } = await import('zod');
z.string().parse('ok');

const server = createServer((req, res) => {
  if (req.url === '/api/health' || req.url === '/api/ready') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uid: process.getuid?.(), mode: process.env.BIGFORGE_MODE }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, host, () => {
  console.log(`scratch app listening on ${host}:${port} uid=${process.getuid?.()}`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
