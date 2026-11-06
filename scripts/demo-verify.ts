// Headless end-to-end check of the complete guided demo through the real HTTP API.
// Boots an in-process server (in-memory database, deterministic provider), signs in as the
// reviewer and performs all 25 steps, asserting the claims the product makes. Exit code 1 on failure.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../apps/api/src/app';
import { Platform, loadConfig } from '../packages/platform/src';
import type { DemoStateDto, ReflexVersionDto, RunDetailDto } from '../packages/schemas/src';

const HEADERS = { 'x-bigforge-client': 'web', 'content-type': 'application/json' };
const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

const dir = await mkdtemp(path.join(tmpdir(), 'bf-verify-'));
const platform = await Platform.create({
  ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
  databaseFile: ':memory:',
});
const app = await buildApp(platform);

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: HEADERS,
    payload: { email, password: 'forge-demo' },
  });
  return `bf_session=${res.cookies.find((c) => c.name === 'bf_session')?.value ?? ''}`;
}
const get = async <T>(cookie: string, url: string) =>
  (await app.inject({ method: 'GET', url, headers: { ...HEADERS, cookie } })).json<T>();
const post = (cookie: string, url: string, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers: { ...HEADERS, cookie }, payload });

try {
  const operator = await login('linus@acme.test');
  const grace = await login('grace@acme.test');
  console.log('BigForge guided demo verification (deterministic provider, offline)\n');

  const blocked = await post(operator, '/api/demo/steps/11/perform');
  check(blocked.statusCode === 403, 'An operator cannot perform the human promotion step (403)');

  const t0 = Date.now();
  let state = await get<DemoStateDto>(grace, '/api/demo');
  console.log(`\n${'#'.padStart(3)}  ${'step'.padEnd(26)}  ${'done'.padEnd(5)}`);
  for (const n of [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  ]) {
    const started = Date.now();
    const res = await post(grace, `/api/demo/steps/${n}/perform`);
    if (res.statusCode !== 200) {
      check(false, `step ${n} performs (HTTP ${res.statusCode}: ${res.body.slice(0, 160)})`);
      break;
    }
    state = res.json<DemoStateDto>();
    const step = state.steps[n - 1];
    console.log(
      `${String(n).padStart(3)}  ${(step?.id ?? '').padEnd(26)}  ${String(state.completed.includes(n)).padEnd(5)}  ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }
  console.log(`\nAll steps: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  check(state.completed.length === 25, 'All 25 steps completed');

  const reflexes = await get<{
    reflexes: { versions: { id: string; version: string; status: string }[] }[];
  }>(grace, '/api/reflexes');
  const statuses = (reflexes.reflexes[0]?.versions ?? [])
    .map((v) => `${v.version}:${v.status}`)
    .sort();
  check(
    JSON.stringify(statuses) === JSON.stringify(['1.0.0:shadow', '1.1.0:candidate']),
    `Original Reflex returned to Shadow and the mutation is only a candidate (${statuses.join(', ')})`,
  );

  const killer = await get<RunDetailDto>(grace, `/api/runs/${state.context.killerRunId ?? ''}`);
  const b = killer.exec?.boundaries[0];
  check(
    killer.usage.modelCalls === 1 && killer.verification === 'pass',
    `Killer moment: 1 model call, verification ${killer.verification}`,
  );
  check(
    JSON.stringify(b?.decision.path) ===
      JSON.stringify(['REDUCE_CONTEXT', 'USE_SMALLER_MODEL', 'ALLOW']),
    `Token Firewall path ${b?.decision.path.join(' > ')}`,
  );
  check(
    (b?.decision.tokensSelected ?? 0) < (b?.decision.tokensConsidered ?? 0) / 3,
    `Evidence reduced ${b?.decision.tokensConsidered} -> ${b?.decision.tokensSelected} tokens`,
  );
  check(
    killer.usage.tokenProvenance === 'synthetic',
    'Token counts are labelled synthetic (deterministic provider)',
  );
  check(
    !JSON.stringify(killer).includes('NOT_A_REAL_SECRET'),
    'Secrets are redacted in the stored trace',
  );

  const mutated = await get<ReflexVersionDto>(
    grace,
    `/api/reflexes/versions/${state.context.mutatedVersionId ?? ''}`,
  );
  check(
    mutated.mutations[0]?.evidence.activated === false &&
      mutated.mutations[0]?.status === 'proposed',
    'Mutation proposed, not activated',
  );
  check(
    mutated.replay.agreement === 1,
    `Mutation regression replay ${mutated.replay.agreements}/${mutated.replay.runs}`,
  );
  check(mutated.integrity.ok, 'Reflex content hash verifies');

  const verify = await get<{ ok: boolean; count: number }>(grace, '/api/audit/verify');
  check(verify.ok, `Audit hash chain verifies (${verify.count} events)`);
} finally {
  await app.close();
  platform.close();
  await rm(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nDemo verification passed.');
