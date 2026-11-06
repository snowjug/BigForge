import { type Page, expect, test } from '@playwright/test';
import type {
  DemoStateDto,
  MutationDto,
  RunDetailDto,
  AuditVerifyDto,
  ReflexVersionDto,
} from '@bigforge/schemas';
import { PERSONAS, apiGet, signInThroughUi } from './helpers';

test.describe.configure({ mode: 'serial' });

/**
 * What must be visible on each step's page once the step is done (or, for view steps, on arrival).
 * Test ids are part of the contract between the pages and this flow.
 */
const onScreen: Record<string, (page: Page) => Promise<void>> = {
  failure_enters: async (page) => {
    await expect(page.getByTestId('task-log')).toBeVisible();
  },
  baseline_handles: async (page) => {
    await expect(page.getByTestId('run-result')).toBeVisible();
    await expect(page.getByTestId('run-verification')).toContainText(/pass|verified/i);
  },
  trace_captured: async (page) => {
    await expect(page.getByTestId('trace-timeline')).toBeVisible();
  },
  family_found: async (page) => {
    await expect(page.getByTestId('family-map')).toBeVisible();
  },
  invariants: async (page) => {
    await expect(page.getByTestId('reflex-dna')).toBeVisible();
  },
  candidate: async (page) => {
    await expect(page.getByTestId('forge-graph')).toBeVisible();
  },
  replay: async (page) => {
    await expect(page.getByTestId('gate-checklist')).toBeVisible();
  },
  shadow: async (page) => {
    await expect(page.getByTestId('shadow-table')).toBeVisible();
  },
  compare: async (page) => {
    await expect(page.getByTestId('gate-checklist')).toBeVisible();
  },
  promote: async (page) => {
    await expect(page.getByTestId('reflex-status')).toContainText(/active/i);
  },
  recognized: async (page) => {
    await expect(page.getByTestId('match-decision')).toContainText(/match/i);
  },
  new_task: async (page) => {
    await expect(page.getByTestId('task-log')).toBeVisible();
  },
  known_steps: async (page) => {
    await expect(page.getByTestId('forge-graph')).toBeVisible();
  },
  boundary: async (page) => {
    await expect(page.getByTestId('uncertainty-lens')).toBeVisible();
  },
  firewall: async (page) => {
    await expect(page.getByTestId('firewall-path')).toContainText(/ALLOW/);
  },
  verified: async (page) => {
    await expect(page.getByTestId('run-verification')).toContainText(/pass|verified/i);
  },
  comparison: async (page) => {
    await expect(page.getByTestId('comparison-table')).toBeVisible();
    await expect(page.getByTestId('exec-lane-baseline')).toBeVisible();
    await expect(page.getByTestId('exec-lane-reflex')).toBeVisible();
  },
  env_change: async (page) => {
    await expect(page.getByTestId('drift-env')).toContainText(/1\.5\.0/);
  },
  canary: async (page) => {
    await expect(page.getByTestId('canary-grid')).toBeVisible();
  },
  confidence_falls: async (page) => {
    await expect(page.getByTestId('confidence-gauge')).toBeVisible();
  },
  back_to_shadow: async (page) => {
    await expect(page.getByTestId('reflex-status')).toContainText(/shadow/i);
  },
  mutation: async (page) => {
    await expect(page.getByTestId('mutation-proposal')).toBeVisible();
    await expect(page.getByTestId('mutation-status')).toContainText(/proposed/i);
  },
};

test('the complete 25-step guided demo works through the real interface', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await signInThroughUi(page, PERSONAS.reviewer);
  await expect(page.getByTestId('provider-chip')).toContainText(/synthetic|deterministic/i);

  await page.getByTestId('start-demo').click();
  const presenter = page.getByTestId('demo-presenter');
  const action = page.getByTestId('demo-action');
  const next = page.getByTestId('demo-next');

  const state = await apiGet<DemoStateDto>(page, '/api/demo');
  expect(state.total).toBe(25);

  for (let n = 1; n <= state.total; n += 1) {
    await expect(presenter).toHaveAttribute('data-step', String(n));
    const stepId = (await presenter.getAttribute('data-step-id')) ?? '';

    if ((await action.count()) > 0) {
      await expect(action, `step ${n} (${stepId}) action`).toBeEnabled();
      await action.click();
      await expect(action, `step ${n} (${stepId}) completes`).toHaveCount(0, { timeout: 240_000 });
    }
    await expect(page.getByTestId('demo-error')).toHaveCount(0);
    await onScreen[stepId]?.(page);

    if (n < state.total) {
      await expect(next).toBeEnabled();
      await next.click();
    }
  }

  // The same story, checked against the server's own records.
  const done = await apiGet<DemoStateDto>(page, '/api/demo');
  expect(done.completed).toHaveLength(25);

  const killer = await apiGet<RunDetailDto>(page, `/api/runs/${done.context.killerRunId}`);
  expect(killer.usage.modelCalls, 'the killer task needs exactly one model call').toBe(1);
  expect(killer.verification).toBe('pass');
  const reference = await apiGet<RunDetailDto>(
    page,
    `/api/runs/${done.context.killerReferenceRunId}`,
  );
  expect(reference.usage.modelCalls).toBeGreaterThanOrEqual(8);

  const reflex = await apiGet<ReflexVersionDto>(
    page,
    `/api/reflexes/versions/${done.context.reflexVersionId}`,
  );
  expect(reflex.integrity.ok).toBe(true);
  expect(reflex.status).toBe('shadow');
  expect(reflex.approvals.some((a) => a.action === 'promote')).toBe(true);

  const { mutations } = await apiGet<{ mutations: MutationDto[] }>(page, '/api/mutations');
  expect(mutations).toHaveLength(1);
  expect(mutations[0]?.status).toBe('proposed');
  expect(mutations[0]?.evidence.activated).toBe(false);

  const chain = await apiGet<AuditVerifyDto>(page, '/api/audit/verify');
  expect(chain.ok).toBe(true);
  expect(consoleErrors).toEqual([]);
});
