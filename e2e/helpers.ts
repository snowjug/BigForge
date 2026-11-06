import { type Page, expect } from '@playwright/test';

export const PASSWORD = 'forge-demo';
const CLIENT_HEADER = { 'x-bigforge-client': 'web' };

export const PERSONAS = {
  reviewer: 'grace@acme.test',
  admin: 'ada@acme.test',
  operator: 'linus@acme.test',
  viewer: 'vera@acme.test',
  otherTenantAdmin: 'gus@globex.test',
} as const;

/** Signs in through the real sign-in page by choosing a persona card. */
export async function signInThroughUi(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId(`persona-${email}`).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Signs in through the API: the session cookie is shared with the page's browser context. */
export async function signInQuickly(page: Page, email: string): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    headers: CLIENT_HEADER,
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `sign in as ${email}`).toBeTruthy();
}

export async function apiGet<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `GET ${url}`).toBeTruthy();
  return (await res.json()) as T;
}

export async function apiPost(page: Page, url: string, data: object = {}) {
  return page.request.post(url, { headers: CLIENT_HEADER, data });
}

/** Chooses the stored theme before any page script runs. */
export async function useTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem('bf.theme', value);
  }, theme);
}

/** Waits until the route has rendered its content and stopped loading. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}
