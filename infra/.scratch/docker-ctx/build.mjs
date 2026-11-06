import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/web', { recursive: true });
cpSync('app/main.mjs', 'dist/server/main.mjs');
writeFileSync('dist/server/forge-ci.mjs', '// placeholder lab tool\n');
writeFileSync('dist/web/index.html', '<!doctype html><title>scratch</title>\n');
writeFileSync(
  'dist/server/package.json',
  JSON.stringify(
    { name: 'scratch-server', private: true, type: 'module', dependencies: { zod: '^4.0.0' } },
    null,
    2,
  ),
);
