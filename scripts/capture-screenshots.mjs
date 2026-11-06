#!/usr/bin/env node
/**
 * Captures the README screenshots from the RUNNING product (production bundle), never from mockups.
 *
 *   npm run build && npm run screenshots          # writes docs/screenshots/*.png
 *
 * It starts the built server on a private port with an in-memory database, signs in as the demo reviewer,
 * fast-forwards the demo to its final state through the same API the presenter uses, then drives a real
 * browser. Needs Chromium: `npx playwright install chromium`.
 */
/* global document */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(root, 'docs/screenshots') },
    port: { type: 'string', default: '4949' },
  },
});
const base = `http://127.0.0.1:${values.port}`;
const bundle = path.join(root, 'dist/server/main.mjs');
if (!existsSync(bundle)) {
  console.error('dist/server/main.mjs not found. Run `npm run build` first.');
  process.exit(1);
}
mkdirSync(values.out, { recursive: true });

const dataDir = await mkdtemp(path.join(tmpdir(), 'bf-shots-'));
const server = spawn('node', [bundle], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env,
    PORT: values.port,
    HOST: '127.0.0.1',
    BIGFORGE_MODE: 'demo',
    BIGFORGE_DATABASE_FILE: ':memory:',
    BIGFORGE_DATA_DIR: dataDir,
  },
});
const stop = async () => {
  server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEADERS = { 'x-bigforge-client': 'web', 'content-type': 'application/json' };

try {
  for (let i = 0; ; i += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 120) throw new Error('The server did not become healthy');
    await sleep(500);
  }

  const browser = await chromium.launch();
  const open = async ({ width, height, theme = 'dark', mobile = false }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      isMobile: mobile,
      hasTouch: mobile,
      baseURL: base,
    });
    await context.addInitScript((value) => localStorage.setItem('bf.theme', value), theme);
    return context;
  };
  const signIn = async (context) => {
    const res = await context.request.post('/api/auth/login', {
      headers: HEADERS,
      data: { email: 'grace@acme.test', password: 'forge-demo' },
    });
    if (!res.ok()) throw new Error(`Sign-in failed: ${res.status()}`);
  };

  const desktop = await open({ width: 1440, height: 900 });
  await signIn(desktop);
  console.log('Fast-forwarding the demo to its final state (about a minute)...');
  const seeded = await desktop.request.post('/api/demo/seed', {
    headers: HEADERS,
    data: { stage: 'complete' },
    timeout: 600_000,
  });
  if (!seeded.ok()) throw new Error(`Seeding failed: ${seeded.status()}`);
  const { context: ids } = await (await desktop.request.get('/api/demo')).json();

  const killer = `/run?task=${ids.taskIds.K1}&run=${ids.killerRunId}`;
  const routes = {
    home: '/',
    killer,
    learn: `/learn?family=${ids.familyId}`,
    reflex: `/reflexes/${ids.reflexVersionId}`,
    shadow: `/shadow?version=${ids.reflexVersionId}`,
    economics: '/economics',
    drift: `/drift?version=${ids.reflexVersionId}`,
    governance: '/governance?tab=audit',
  };

  const page = await desktop.newPage();
  const settle = async (p) => {
    await p.waitForLoadState('networkidle');
    await p.locator('main').first().waitFor({ state: 'visible' });
    await sleep(600);
  };
  const file = (name) => path.join(values.out, name);
  /** The app scrolls inside <main>, so scroll that (scrollIntoView would also shift the clipped shell). */
  const scrollMain = async (target, offset) => {
    await target.first().evaluate((el, gap) => {
      const main = document.querySelector('main.bf-main');
      if (!main) return;
      main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - gap;
    }, offset);
    await sleep(350);
  };
  // The Run Console has a sticky "Jump to" bar of about 56px; leave room for it.
  const RUN_OFFSET = 72;
  const view = async (p, route, name, { focus, offset = 16 } = {}) => {
    await p.goto(route);
    await settle(p);
    if (focus) await scrollMain(p.getByTestId(focus), offset);
    await p.screenshot({ path: file(name) });
    console.log(`  ${name}`);
  };
  /** A tall region: grow the viewport so it is not stitched together from several screens, then clip to it. */
  const region = async (p, route, name, locator, { maxHeight, offset = 16, pad = 24 }) => {
    await p.goto(route);
    await settle(p);
    await p.setViewportSize({ width: 1440, height: 2400 });
    await sleep(600);
    await scrollMain(locator, offset);
    const box = await locator.first().boundingBox();
    if (!box) throw new Error(`${name}: region not found`);
    const x = Math.max(0, box.x - pad);
    await p.screenshot({
      path: file(name),
      clip: {
        x,
        y: Math.max(0, box.y - pad / 2),
        width: Math.min(1440 - x, box.width + pad * 2),
        height: Math.min(box.height, maxHeight) + pad,
      },
    });
    await p.setViewportSize({ width: 1440, height: 900 });
    await sleep(300);
    console.log(`  ${name}`);
  };
  const panelOf = (p, testid) =>
    p
      .getByTestId(testid)
      .first()
      .locator('xpath=ancestor::section[contains(@class,"bf-panel")][1]');

  await view(page, routes.home, '01-forge-floor.png');
  await view(page, routes.killer, '02-run-console-killer.png');
  const lens = page.getByTestId('uncertainty-lens');
  await region(page, routes.killer, '03-uncertainty-lens.png', lens, {
    maxHeight: 1080,
    offset: RUN_OFFSET,
  });
  const baseline = panelOf(page, 'exec-lane-baseline');
  await region(page, routes.killer, '04-baseline-vs-reflex.png', baseline, {
    maxHeight: 980,
    offset: RUN_OFFSET,
  });
  await region(page, routes.learn, '05-reflex-dna.png', page.getByTestId('reflex-dna'), {
    maxHeight: 1100,
  });
  await view(page, routes.reflex, '06-reflex-detail.png');
  await view(page, routes.shadow, '07-shadow-lab.png');
  await view(page, routes.economics, '08-economics.png');
  await view(page, routes.drift, '09-drift-fracture.png', { focus: 'drift-fracture' });

  await page.goto(routes.governance);
  await settle(page);
  await page.getByTestId('verify-chain').click();
  await page.getByTestId('verify-chain-result').waitFor();
  await page.screenshot({ path: file('10-governance.png') });
  console.log('  10-governance.png');

  const light = await open({ width: 1440, height: 900, theme: 'light' });
  await signIn(light);
  await view(await light.newPage(), routes.economics, '11-light-theme.png');

  const phone = await open({ width: 390, height: 844, mobile: true });
  await signIn(phone);
  await view(await phone.newPage(), routes.killer, '12-mobile.png');

  // Last, because it moves the shared presenter cursor: the presenter on the Token Firewall step.
  await desktop.request.post('/api/demo/goto', { headers: HEADERS, data: { step: 16 } });
  await page.addInitScript(() => sessionStorage.setItem('bf.demo.open', '1'));
  await view(page, routes.killer, '13-presenter.png', {
    focus: 'uncertainty-lens',
    offset: RUN_OFFSET,
  });
  await desktop.request.post('/api/demo/goto', { headers: HEADERS, data: { step: 25 } });

  await browser.close();
  console.log(`Screenshots written to ${path.relative(root, values.out)}`);
} finally {
  await stop();
}
