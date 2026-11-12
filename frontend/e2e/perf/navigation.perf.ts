// Measures sidebar navigation: click → URL, click → active nav highlight, click → page heading, click → content
// without skeletons, blank-<main> frames, long tasks, and API / RPC / JS-chunk / RSC requests per navigation.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Browser, type Page, type Request } from '@playwright/test';
import { API_URL, RPC_URL } from '../stack';

const HEADINGS: Record<string, string> = {
  '/': 'Dashboard',
  '/treasury': 'Treasury',
  '/obligations': 'Obligation Management',
  '/cash-ladder': 'Cash Ladder',
  '/vault': 'Yield Vault',
  '/pools': 'Pool Risk Dashboard',
  '/stress-test': 'Stress Test',
  '/agent': 'AI Agent Activity',
  '/transactions': 'Transactions',
  '/settings': 'Settings & Policy Configuration',
};
const PATH = ['/treasury', '/obligations', '/transactions', '/settings'];
const LOOP = ['/', '/treasury', '/obligations', '/cash-ladder', '/vault', '/pools', '/stress-test', '/agent', '/transactions', '/settings'];
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const SLOW_RUNS = Number(process.env.PERF_SLOW_RUNS ?? 3);
const API_DELAY_MS = 2_500;
const OUT = process.env.PERF_OUT ?? resolve(dirname(fileURLToPath(import.meta.url)), '.results', `${process.env.PERF_MODE ?? 'dev'}.json`);

interface Sample {
  scenario: string;
  run: number;
  from: string;
  to: string;
  visit: 'first' | 'repeat';
  url: number | null;
  active: number | null;
  heading: number | null;
  ready: number | null;
  blankFrames: number;
  oldPageFrames: number;
  longTaskMs: number;
  maxLongTask: number;
  api: number;
  apiDup: number;
  rpc: number;
  js: number;
  rsc: number;
}

declare global {
  interface Window {
    __perf?: {
      expect: { href: string; heading: string } | null;
      t0: number;
      url: number | null;
      active: number | null;
      heading: number | null;
      ready: number | null;
      blank: number;
      old: number;
      longTasks: { start: number; dur: number }[];
      done: boolean;
    };
  }
}

// Runs in the page: samples every animation frame after a nav-link click until the target content is ready.
function installSampler() {
  const longTasks: { start: number; dur: number }[] = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push({ start: e.startTime, dur: e.duration }))).observe({ entryTypes: ['longtask'] });
  } catch {
    /* unsupported */
  }
  document.addEventListener(
    'click',
    (ev) => {
      const p = window.__perf;
      const a = (ev.target as Element | null)?.closest?.('nav[aria-label="Main"] a');
      if (!p || !p.expect || !a) return;
      Object.assign(p, { t0: performance.now(), url: null, active: null, heading: null, ready: null, blank: 0, old: 0, done: false });
      const { href, heading } = p.expect;
      const tick = () => {
        const now = performance.now() - p.t0;
        if (p.url === null && location.pathname === href) p.url = now;
        const cur = document.querySelector('nav[aria-label="Main"] a[aria-current="page"]');
        if (p.active === null && cur?.getAttribute('href') === href) p.active = now;
        const main = document.getElementById('main-content');
        const h1 = main?.querySelector('h1')?.textContent?.trim();
        if (!main || !(main.innerText ?? '').trim()) p.blank++;
        else if (h1 !== heading && location.pathname === href) p.old++;
        if (p.heading === null && h1 === heading) p.heading = now;
        if (p.heading !== null && p.ready === null && main && !main.querySelector('[aria-busy="true"],[data-testid="skeleton-grid"]')) p.ready = now;
        if (p.ready !== null || now > 20_000) {
          p.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    true,
  );
  window.__perf = { expect: null, t0: 0, url: null, active: null, heading: null, ready: null, blank: 0, old: 0, longTasks, done: false };
}

async function waitReady(page: Page, href: string) {
  await page.waitForFunction(
    (h) => {
      const main = document.getElementById('main-content');
      return !!main && main.querySelector('h1')?.textContent?.trim() === h && !main.querySelector('[aria-busy="true"],[data-testid="skeleton-grid"]');
    },
    HEADINGS[href],
    { timeout: 120_000 },
  );
}

async function navigate(page: Page, reqs: Request[], scenario: string, run: number, from: string, to: string, visit: 'first' | 'repeat'): Promise<Sample> {
  await page.evaluate((e) => Object.assign(window.__perf!, { expect: e, done: false }), { href: to, heading: HEADINGS[to]! });
  reqs.length = 0;
  await page.locator(`nav[aria-label="Main"] a[href="${to}"]`).click();
  await page.waitForFunction(() => window.__perf?.done === true, undefined, { timeout: 120_000, polling: 50 });
  await page.waitForTimeout(500); // requests issued right after content-ready (mount fetches) still count
  const p = await page.evaluate(() => {
    const s = window.__perf!;
    const end = s.t0 + (s.ready ?? 20_000) + 500;
    const tasks = s.longTasks.filter((t) => t.start >= s.t0 && t.start <= end);
    return {
      url: s.url,
      active: s.active,
      heading: s.heading,
      ready: s.ready,
      blank: s.blank,
      old: s.old,
      longTaskMs: tasks.reduce((n, t) => n + t.dur, 0),
      maxLongTask: tasks.reduce((n, t) => Math.max(n, t.dur), 0),
    };
  });
  const api = reqs.filter((r) => r.url().startsWith(API_URL));
  const apiKeys = api.map((r) => r.url());
  const sample: Sample = {
    scenario,
    run,
    from,
    to,
    visit,
    url: p.url,
    active: p.active,
    heading: p.heading,
    ready: p.ready,
    blankFrames: p.blank,
    oldPageFrames: p.old,
    longTaskMs: Math.round(p.longTaskMs),
    maxLongTask: Math.round(p.maxLongTask),
    api: api.length,
    apiDup: apiKeys.length - new Set(apiKeys).size,
    rpc: reqs.filter((r) => r.url().startsWith(RPC_URL) && r.method() === 'POST').length,
    js: reqs.filter((r) => /\/_next\/static\/.*\.js/.test(r.url())).length,
    rsc: reqs.filter((r) => r.url().includes('_rsc=') || r.headers()['rsc'] === '1').length,
  };
  console.log(JSON.stringify(sample));
  return sample;
}

async function session(browser: Browser, scenario: string, run: number, slowApi: boolean, out: Sample[]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(installSampler);
  if (slowApi) {
    await page.route(`${API_URL}/**`, async (route) => {
      await new Promise((r) => setTimeout(r, API_DELAY_MS));
      await route.continue().catch(() => undefined);
    });
  }
  const reqs: Request[] = [];
  page.on('request', (r) => reqs.push(r));
  await page.goto('/');
  await waitReady(page, '/');
  await page.waitForTimeout(3_000); // idle: lets production <Link> prefetch run
  const seen = new Set(['/']);
  let from = '/';
  for (const to of [...PATH, ...(slowApi ? [] : [...LOOP.slice(1), ...LOOP, ...LOOP.slice(0, 1)])]) {
    if (to === from) continue;
    out.push(await navigate(page, reqs, scenario, run, from, to, seen.has(to) ? 'repeat' : 'first'));
    seen.add(to);
    from = to;
    await page.waitForTimeout(300);
  }
  await context.close();
}

test('navigation performance', async ({ browser }) => {
  const samples: Sample[] = [];
  for (let run = 1; run <= RUNS; run++) await session(browser, 'normal', run, false, samples);
  for (let run = 1; run <= SLOW_RUNS; run++) await session(browser, 'slow-api', run, true, samples);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(samples, null, 1));
});
