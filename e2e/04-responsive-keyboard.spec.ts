import { type Page, expect, test } from '@playwright/test';
import type { DemoStateDto } from '@bigforge/schemas';
import { PERSONAS, apiGet, apiPost, settle, signInQuickly, signInThroughUi } from './helpers';

test.describe.configure({ mode: 'serial' });

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1366, height: 768 },
] as const;

let context: DemoStateDto['context'];

const pages = (c: DemoStateDto['context']) => [
  '/',
  '/run',
  `/run?task=${c.taskIds.K1 ?? ''}&run=${c.killerRunId ?? ''}`,
  '/traces',
  `/traces/${c.firstRunId ?? ''}`,
  `/learn?family=${c.familyId ?? ''}`,
  '/reflexes',
  `/reflexes/${c.reflexVersionId ?? ''}`,
  `/shadow?version=${c.reflexVersionId ?? ''}`,
  '/economics',
  `/drift?version=${c.reflexVersionId ?? ''}`,
  '/governance',
  '/settings',
];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('prepare: complete demo data', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await signInQuickly(page, PERSONAS.reviewer);
  expect((await apiPost(page, '/api/demo/seed', { stage: 'complete' })).ok()).toBeTruthy();
  context = (await apiGet<DemoStateDto>(page, '/api/demo')).context;
});

for (const viewport of VIEWPORTS) {
  test(`no view scrolls the whole page sideways at ${viewport.name} (${viewport.width}px)`, async ({
    page,
  }) => {
    test.setTimeout(5 * 60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInQuickly(page, PERSONAS.reviewer);
    const overflowing: string[] = [];
    for (const path of pages(context)) {
      await page.goto(path);
      await settle(page);
      if ((await horizontalOverflow(page)) > 1) overflowing.push(path);
    }
    expect(overflowing, 'wide content must scroll inside its own panel').toEqual([]);
  });
}

test('keyboard: the skip link is first and moves focus to the main content', async ({ page }) => {
  await signInQuickly(page, PERSONAS.reviewer);
  await page.goto('/');
  await settle(page);
  await page.keyboard.press('Tab');
  const skip = page.locator(':focus');
  await expect(skip).toHaveText(/skip/i);
  await page.keyboard.press('Enter');
  await expect(page.locator('main:focus, #main:focus, main :focus').first()).toBeAttached();
});

test('appearance: the theme and motion preferences apply and persist', async ({ page }) => {
  await signInThroughUi(page, PERSONAS.reviewer);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  // The test runner emulates reduced motion, so the app starts with motion reduced.
  await expect(html).toHaveAttribute('data-motion', 'reduced');
});
