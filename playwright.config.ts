import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4848);
const baseURL = `http://127.0.0.1:${port}`;
const bundle = path.resolve('dist/server/main.mjs');

if (!existsSync(bundle) && !process.env.E2E_SKIP_BUNDLE_CHECK) {
  throw new Error('dist/server/main.mjs not found. Run `npm run build` before `npm run test:e2e`.');
}

/**
 * End-to-end tests drive the production bundle (API + built web app), exactly what `npm start` and
 * the container run. The database is in memory so every run starts from a clean seeded demo.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `node ${bundle}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      BIGFORGE_DATABASE_FILE: ':memory:',
      BIGFORGE_DATA_DIR: path.join(os.tmpdir(), 'bigforge-e2e'),
      BIGFORGE_MODE: 'demo',
      BIGFORGE_PROVIDER_MODE: 'deterministic',
    },
  },
});
