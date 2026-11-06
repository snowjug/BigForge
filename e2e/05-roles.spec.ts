import { expect, test } from '@playwright/test';
import type { DemoStateDto } from '@bigforge/schemas';
import { PERSONAS, apiGet, apiPost, settle, signInQuickly, signInThroughUi } from './helpers';

test.describe.configure({ mode: 'serial' });

let context: DemoStateDto['context'];

test('prepare: complete demo data', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await signInQuickly(page, PERSONAS.reviewer);
  expect((await apiPost(page, '/api/demo/seed', { stage: 'complete' })).ok()).toBeTruthy();
  context = (await apiGet<DemoStateDto>(page, '/api/demo')).context;
});

test('a viewer can read everything but cannot act', async ({ page }) => {
  await signInThroughUi(page, PERSONAS.viewer);
  await page.goto('/run');
  await settle(page);
  await expect(page.getByTestId('send-failure').first()).toBeDisabled();

  const created = await apiPost(page, '/api/tasks', { scenarioId: 'L1' });
  expect(created.status()).toBe(403);
  const promote = await apiPost(
    page,
    `/api/reflexes/versions/${context.reflexVersionId}/promote`,
    {},
  );
  expect(promote.status()).toBe(403);
  expect((await page.request.get('/api/reflexes')).status()).toBe(200);
});

test('an operator can run work but cannot promote or approve', async ({ page }) => {
  await signInThroughUi(page, PERSONAS.operator);
  const promote = await apiPost(page, `/api/reflexes/versions/${context.reflexVersionId}/promote`, {
    comment: 'trying anyway',
  });
  expect(promote.status()).toBe(403);
  const approve = await apiPost(page, `/api/mutations/${context.mutationId}/approve`, {});
  expect(approve.status()).toBe(403);
});

test('another tenant sees none of the first tenant data', async ({ page }) => {
  await signInThroughUi(page, PERSONAS.otherTenantAdmin);
  const runs = await apiGet<{ items: unknown[] }>(page, '/api/runs');
  expect(runs.items).toHaveLength(0);
  const reflexes = await apiGet<{ reflexes: unknown[] }>(page, '/api/reflexes');
  expect(reflexes.reflexes).toHaveLength(0);
  const foreign = await page.request.get(`/api/reflexes/versions/${context.reflexVersionId}`);
  expect(foreign.status()).toBe(404);
  const reset = await apiPost(page, '/api/demo/reset', {});
  expect(reset.status()).toBe(403);
});
