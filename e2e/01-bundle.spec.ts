import { expect, test } from '@playwright/test';

test.describe('production bundle', () => {
  test('serves the web app, falls back to it for client routes and keeps /api as JSON', async ({
    request,
  }) => {
    const root = await request.get('/');
    expect(root.status()).toBe(200);
    expect(root.headers()['content-type']).toContain('text/html');
    expect(await root.text()).toContain('id="root"');

    const deep = await request.get('/reflexes');
    expect(deep.status()).toBe(200);
    expect(deep.headers()['content-type']).toContain('text/html');

    const missing = await request.get('/api/does-not-exist');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toContain('application/json');
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });

    const health = await request.get('/api/health');
    expect(await health.json()).toMatchObject({ status: 'ok' });
  });

  test('ships hardening headers and never exposes data without a session', async ({ request }) => {
    const res = await request.get('/');
    const headers = res.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');

    for (const url of ['/api/tasks', '/api/reflexes', '/api/system', '/api/economics']) {
      expect((await request.get(url)).status(), url).toBe(401);
    }
  });
});
