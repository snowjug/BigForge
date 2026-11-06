import AxeBuilder from '@axe-core/playwright';
import type { DemoStateDto } from '@bigforge/schemas';
import { type Page, expect, test } from '@playwright/test';
import { PERSONAS, apiGet, apiPost, settle, signInQuickly, useTheme } from './helpers';

test.describe.configure({ mode: 'serial' });

interface Route {
  name: string;
  path: (ctx: DemoStateDto['context']) => string;
}

/** Every primary view, populated by the complete demo. */
const ROUTES: Route[] = [
  { name: 'forge floor', path: () => '/' },
  { name: 'run console (empty)', path: () => '/run' },
  {
    name: 'run console (killer task)',
    path: (c) => `/run?task=${c.taskIds.K1 ?? ''}&run=${c.killerRunId ?? ''}`,
  },
  { name: 'traces', path: () => '/traces' },
  { name: 'trace detail', path: (c) => `/traces/${c.firstRunId ?? ''}` },
  { name: 'learn', path: (c) => `/learn?family=${c.familyId ?? ''}` },
  { name: 'reflexes', path: () => '/reflexes' },
  { name: 'reflex detail', path: (c) => `/reflexes/${c.reflexVersionId ?? ''}` },
  { name: 'shadow lab', path: (c) => `/shadow?version=${c.reflexVersionId ?? ''}` },
  { name: 'economics', path: () => '/economics' },
  { name: 'drift', path: (c) => `/drift?version=${c.reflexVersionId ?? ''}` },
  { name: 'governance (audit)', path: () => '/governance?tab=audit' },
  { name: 'governance (approvals)', path: () => '/governance?tab=approvals' },
  { name: 'governance (roles)', path: () => '/governance?tab=roles' },
  { name: 'governance (safety)', path: () => '/governance?tab=safety' },
  { name: 'settings', path: () => '/settings' },
];

let context: DemoStateDto['context'];

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
    }));
}

test('prepare: the demo is complete so every view has real data', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await signInQuickly(page, PERSONAS.reviewer);
  const res = await apiPost(page, '/api/demo/seed', { stage: 'complete' });
  expect(res.ok()).toBeTruthy();
  context = (await apiGet<DemoStateDto>(page, '/api/demo')).context;
  expect(context.reflexVersionId).toBeTruthy();
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    for (const route of ROUTES) {
      test(`${route.name} has no serious or critical violations`, async ({ page }) => {
        await useTheme(page, theme);
        await signInQuickly(page, PERSONAS.reviewer);
        await page.goto(route.path(context));
        await settle(page);
        expect(await seriousViolations(page)).toEqual([]);
      });
    }

    test('the sign-in page has no serious or critical violations', async ({ page }) => {
      await useTheme(page, theme);
      await page.goto('/login');
      await expect(page.getByTestId(`persona-${PERSONAS.reviewer}`)).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}
