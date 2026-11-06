#!/usr/bin/env node
/**
 * Screenshot helper for the BigForge web app (design review and docs).
 *
 *   node scripts/shot.mjs --path /governance --out shots/gov.png
 *   node scripts/shot.mjs --path /reflexes --width 390 --height 844 --theme light --full
 *   node scripts/shot.mjs --path / --as vera@acme.test --reduced-motion --axe
 *   node scripts/shot.mjs --path /governance --matrix --out shots/gov     (1440x900 + 390x844, dark + light)
 *
 * It signs in through POST /api/auth/login (header X-BigForge-Client: web) so the session cookie is set,
 * waits for the network to go idle, takes the screenshot and prints console errors, page errors and
 * failed API calls. Assumes the dev stack is running (`npm run dev`): web on http://127.0.0.1:5173.
 */
/* global document, window */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const HELP = `Usage: node scripts/shot.mjs --path <route> [options]

  --path <route>         App route to open, e.g. /governance?tab=roles   (default /)
  --out <file.png>       Output file; with --matrix a name prefix            (default screenshots/shot.png)
  --width <px>           Viewport width                                      (default 1440)
  --height <px>          Viewport height                                     (default 900)
  --theme dark|light     Theme to apply before load                          (default dark)
  --reduced-motion       Reduce motion (OS media query and the in-app preference)
  --as <email>           Persona to sign in as                               (default grace@acme.test)
  --password <text>      Password                                            (default forge-demo)
  --no-login             Do not sign in (screenshot /login or the signed-out state)
  --full                 Capture the whole scrollable page, not only the viewport
  --matrix               Capture 1440x900 and 390x844 in dark and light; --out becomes a prefix
  --base <url>           Web origin                                          (default http://127.0.0.1:5173)
  --wait-for <selector>  Wait for this selector before capturing
  --click <selector>     Click before capturing (repeatable, in order)
  --hover <selector>     Hover before capturing
  --keys <combo>         Press a key before capturing, e.g. Escape or ArrowRight (repeatable)
  --delay <ms>           Extra wait after load and interactions               (default 400)
  --session <key=value>  Set a sessionStorage value before load (repeatable), e.g. bf.demo.open=1
  --local <key=value>    Set a localStorage value before load (repeatable)
  --axe                  Run axe-core and print serious and critical violations
  --strict               Exit with status 1 when errors or violations were found
  --help                 Show this help
`;

const { values } = parseArgs({
  options: {
    path: { type: 'string', default: '/' },
    out: { type: 'string', default: 'screenshots/shot.png' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    theme: { type: 'string', default: 'dark' },
    'reduced-motion': { type: 'boolean', default: false },
    as: { type: 'string', default: 'grace@acme.test' },
    password: { type: 'string', default: 'forge-demo' },
    'no-login': { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
    matrix: { type: 'boolean', default: false },
    base: { type: 'string', default: process.env.BIGFORGE_URL ?? 'http://127.0.0.1:5173' },
    'wait-for': { type: 'string' },
    click: { type: 'string', multiple: true, default: [] },
    hover: { type: 'string' },
    keys: { type: 'string', multiple: true, default: [] },
    delay: { type: 'string', default: '400' },
    session: { type: 'string', multiple: true, default: [] },
    local: { type: 'string', multiple: true, default: [] },
    axe: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

/** Playwright wants the browser revision it was released with; fall back to any cached Chromium. */
function findBrowser() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // executablePath() throws when no browser is registered; look in the cache instead.
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(homedir(), '.cache', 'ms-playwright'),
  ]
    .filter(Boolean)
    .filter((root) => existsSync(root));
  const newestFirst = (a, b) => b.localeCompare(a, undefined, { numeric: true });
  for (const root of roots) {
    const entries = readdirSync(root);
    const candidates = [
      ...entries
        .filter((name) => name.startsWith('chromium_headless_shell-'))
        .sort(newestFirst)
        .map((name) =>
          path.join(root, name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        ),
      ...entries
        .filter((name) => name.startsWith('chromium-'))
        .sort(newestFirst)
        .map((name) => path.join(root, name, 'chrome-linux64', 'chrome')),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) return found;
  }
  return undefined;
}

const pairs = (list) =>
  list.map((entry) => {
    const index = entry.indexOf('=');
    if (index < 1) throw new Error(`Expected key=value, got "${entry}"`);
    return [entry.slice(0, index), entry.slice(index + 1)];
  });

async function shoot(browser, job) {
  const reduced = values['reduced-motion'];
  const context = await browser.newContext({
    viewport: { width: job.width, height: job.height },
    colorScheme: job.theme === 'light' ? 'light' : 'dark',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    deviceScaleFactor: 1,
  });
  const problems = [];

  await context.addInitScript(
    ({ theme, reducedMotion, session, local }) => {
      try {
        localStorage.setItem('bf.theme', theme);
        if (reducedMotion) localStorage.setItem('bf.motion', 'reduced');
        for (const [key, value] of local) localStorage.setItem(key, value);
        for (const [key, value] of session) sessionStorage.setItem(key, value);
      } catch {
        // Storage is unavailable on about:blank; the real page is loaded after this runs.
      }
    },
    {
      theme: job.theme,
      reducedMotion: reduced,
      session: pairs(values.session),
      local: pairs(values.local),
    },
  );

  if (!values['no-login']) {
    const response = await context.request.post(`${values.base}/api/auth/login`, {
      headers: { 'X-BigForge-Client': 'web', 'Content-Type': 'application/json' },
      data: { email: values.as, password: values.password },
    });
    if (!response.ok()) {
      throw new Error(
        `Sign-in as ${values.as} failed: ${response.status()} ${await response.text()}`,
      );
    }
  }

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    // Aborted requests are cancelled fetches and navigations, not failures.
    if (reason.includes('ERR_ABORTED')) return;
    problems.push(`request failed: ${request.method()} ${request.url()} (${reason})`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && response.status() >= 500) {
      problems.push(
        `server error: ${response.request().method()} ${url.pathname} -> ${response.status()}`,
      );
    }
  });

  await page.goto(new URL(values.path, values.base).toString(), { waitUntil: 'networkidle' });
  if (values['wait-for']) await page.waitForSelector(values['wait-for'], { timeout: 15000 });
  for (const selector of values.click) {
    await page.click(selector);
    await page.waitForLoadState('networkidle');
  }
  if (values.hover) await page.hover(values.hover);
  for (const key of values.keys) await page.keyboard.press(key);
  await page.waitForTimeout(Number(values.delay));

  if (values.full) {
    const height = await page.evaluate(() => {
      const main = document.querySelector('main.bf-main');
      if (!main) return document.documentElement.scrollHeight;
      return main.scrollHeight + (window.innerHeight - main.clientHeight);
    });
    await page.setViewportSize({
      width: job.width,
      height: Math.min(Math.max(height, job.height), 9000),
    });
    await page.waitForTimeout(200);
  }

  mkdirSync(path.dirname(path.resolve(job.out)), { recursive: true });
  await page.screenshot({ path: job.out, fullPage: values.full });

  const violations = [];
  if (values.axe) {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const result = await new AxeBuilder({ page }).analyze();
    for (const violation of result.violations) {
      if (violation.impact === 'serious' || violation.impact === 'critical') {
        violations.push(
          `axe ${violation.impact}: ${violation.id} (${violation.nodes.length}) ${violation.help}\n      ${violation.nodes
            .slice(0, 3)
            .map((node) => node.target.join(' '))
            .join('\n      ')}`,
        );
      }
    }
  }

  await context.close();
  return { problems, violations };
}

const jobs = values.matrix
  ? ['dark', 'light'].flatMap((theme) =>
      [
        { width: 1440, height: 900, tag: '1440' },
        { width: 390, height: 844, tag: '390' },
      ].map((size) => ({
        theme,
        width: size.width,
        height: size.height,
        out: `${values.out.replace(/\.png$/, '')}-${theme}-${size.tag}.png`,
      })),
    )
  : [
      {
        theme: values.theme,
        width: Number(values.width),
        height: Number(values.height),
        out: values.out,
      },
    ];

const executablePath = findBrowser();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let failed = false;
try {
  for (const job of jobs) {
    const { problems, violations } = await shoot(browser, job);
    process.stdout.write(`saved ${job.out}  (${job.width}x${job.height}, ${job.theme})\n`);
    for (const line of problems) process.stdout.write(`  ! ${line}\n`);
    for (const line of violations) process.stdout.write(`  ! ${line}\n`);
    if (problems.length === 0 && violations.length === 0)
      process.stdout.write(
        values.axe
          ? '  no console errors, no serious or critical axe violations\n'
          : '  no console errors\n',
      );
    if (problems.length > 0 || violations.length > 0) failed = true;
  }
} finally {
  await browser.close();
}
if (failed && values.strict) process.exit(1);
