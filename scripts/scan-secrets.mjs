// Lightweight secret scan over tracked and untracked-but-not-ignored files. Complements (does not replace) provider-side secret scanning.
// Known synthetic demo tokens are allow-listed explicitly.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);

const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|lock)$/i;
const SKIP_FILES = new Set(['package-lock.json']);
const ALLOW = [
  /frg_demo_NOT_A_REAL_SECRET_\d+/,
  /forge-demo/,
  /bigforge-demo-session-secret-not-for-production/,
  /hunter2pass/,
  /k9d82hf72hd82hd8fh2d8/,
  /abcdefghijklmnop1234/,
];

const RULES = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key id', /\b(AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Azure storage/connection key', /AccountKey=[A-Za-z0-9+/=]{40,}/],
  [
    'Application Insights key',
    /InstrumentationKey=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  ],
  ['generic bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/],
  [
    'assigned secret',
    /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9/+_=-]{24,}["']/i,
  ],
];

const forbiddenTracked = files
  .filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example'))
  .concat(
    files.filter((f) => /\.(db|sqlite3?|pem|pfx)$/.test(f) || /(^|\/)node_modules\//.test(f)),
  );
const findings = [];
for (const f of forbiddenTracked) findings.push(`${f}: tracked file type must not be committed`);

for (const f of files) {
  if (SKIP_EXT.test(f) || SKIP_FILES.has(path.basename(f))) continue;
  let text;
  try {
    text = readFileSync(path.join(root, f), 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (ALLOW.some((a) => a.test(line))) return;
    for (const [name, re] of RULES)
      if (re.test(line)) findings.push(`${f}:${i + 1}: possible ${name}`);
  });
}

if (findings.length > 0) {
  console.error(
    `Secret scan found ${findings.length} issue(s):\n${findings.map((x) => `  ${x}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`Secret scan clean: ${files.length} files checked (tracked + untracked, not ignored).`);
