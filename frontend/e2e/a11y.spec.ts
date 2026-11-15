// docs/08 §9 automated accessibility gate: axe-core (WCAG 2.0/2.1 A + AA) on every route against the real E2E stack,
// plus the 375 px no-horizontal-scroll check and the DEMO MODE banner. Read-only: no wallet connection, no chain
// writes, so it can run before app.spec.ts without changing the shared chain state.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { APP_ROUTES } from '../lib/routes';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Wait until the page heading is up and loading skeletons are gone (data, empty or error state rendered). */
async function waitForSettled(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"], [data-testid="skeleton-grid"]')).toHaveCount(0, { timeout: 60_000 });
}

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations.map(
    (v) => `${v.id} [${v.impact}] ${v.help} — ${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

// Sidebar routes plus pages reached from them (e.g. /obligations/new).
const PAGES = [...APP_ROUTES.map((r) => r.href), '/obligations/new'];

for (const href of PAGES) {
  const route = { href };
  test(`a11y: ${route.href} has no WCAG A/AA axe violations (wallet not connected)`, async ({ page }) => {
    await page.goto(route.href);
    await waitForSettled(page);
    // Read-only view: admin controls are explained by a visible, keyboard-reachable notice (docs/08 §8).
    expect(await axeViolations(page)).toEqual([]);
  });
}

test('a11y: every route fits 375 px without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const href of PAGES) {
    const route = { href };
    await page.goto(route.href);
    await waitForSettled(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route.href} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test('a11y: DEMO MODE · DD/MM/YY badge is visible on load and a skip link reaches main content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-mode-badge')).toBeVisible();
  await expect(page.getByTestId('demo-mode-badge')).toContainText(/Demo mode/i);
  await expect(page.getByTestId('demo-mode-badge')).toContainText(/\d{2}\/\d{2}\/\d{2}/);
  await expect(page.getByTestId('demo-mode-badge')).not.toContainText(/Day \d+/);
  await expect(page.getByText('Chain time is simulated')).toHaveCount(0);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('sidebar: collapses to an icon strip and expands again; choice persists; links keep their names; no axe violations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/obligations');
  await waitForSettled(page);
  const nav = page.locator('#desktop-nav');
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  const wide = (await nav.boundingBox())!.width;
  const main = page.locator('#main-content');
  const mainBefore = (await main.boundingBox())!.width;

  await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand sidebar' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(nav).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThan(80);
  expect(wide).toBeGreaterThan(200);
  // The page gains the freed width; every link is still reachable by name (sr-only label + tooltip).
  await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(mainBefore + 150);
  for (const name of ['Dashboard', 'Obligation Management', 'Settings & Policy Configuration']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Obligation Management' })).toHaveAttribute('aria-current', 'page');
  expect(await axeViolations(page)).toEqual([]);

  // Remembered across reloads (per browser), and navigation still works while collapsed.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await nav.getByRole('link', { name: 'Transaction History' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transactions');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeGreaterThan(200);
});

test('obligations: search by label and filter by category (read-only, seeded data)', async ({ page }) => {
  await page.goto('/obligations');
  await waitForSettled(page);
  const table = page.getByRole('table');
  const filters = page.getByRole('search', { name: 'Filter obligations' });
  await expect(table.getByRole('cell', { name: 'November payroll', exact: true })).toBeVisible();

  // Search: case-insensitive on the label.
  await filters.getByRole('searchbox', { name: 'Search by label' }).fill('PAYROLL');
  await expect(table.getByRole('cell', { name: 'November payroll', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'December payroll', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Q1 grant', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('obligation-count')).toHaveText(/^Showing \d+ of \d+$/);

  // Category + search combine: nothing matches → explicit empty state, then Clear filters restores the list.
  await filters.getByLabel('Category').selectOption('GRANT');
  await expect(page.getByText('No obligations match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(filters.getByRole('searchbox', { name: 'Search by label' })).toHaveValue('');
  await expect(filters.getByLabel('Category')).toHaveValue('ALL');
  await expect(page.getByTestId('obligation-count')).toHaveCount(0); // no count text without an active filter

  // Category only.
  await filters.getByLabel('Category').selectOption('GRANT');
  await expect(table.getByRole('cell', { name: 'Q1 grant', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: /payroll/ })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('cash ladder: liquidity projection date range (presets + two-handle slider, DD/MM/YY)', async ({ page }) => {
  await page.goto('/cash-ladder');
  await waitForSettled(page);
  await expect(page.getByText(/amounts in USDC/)).toHaveCount(0);
  // The filter is collapsed until the user opens it.
  const toggle = page.getByRole('button', { name: 'Filter dates' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const range = page.getByRole('group', { name: 'Date range' });
  await expect(range).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const summary = range.getByTestId('date-range-summary');
  const start = range.getByRole('slider', { name: 'Start date' });
  const end = range.getByRole('slider', { name: 'End date' });
  const all = range.getByRole('button', { name: 'All' });
  const dmy = /^\d{2}\/\d{2}\/\d{2}$/;

  // Default: the whole projection (N daily points).
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  const total = Number(await end.getAttribute('max')) + 1;
  await expect(summary).toContainText(`${total} days`);
  expect(await start.getAttribute('aria-valuetext')).toMatch(dmy);

  // Preset.
  await range.getByRole('button', { name: 'Next 7 days' }).click();
  await expect(range.getByRole('button', { name: 'Next 7 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(summary).toContainText('7 days');
  await expect(end).toHaveValue('6');

  // Keyboard on the handles: one day per arrow press; the start cannot pass the end.
  await start.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(start).toHaveValue('2');
  await expect(summary).toContainText('5 days');
  await page.keyboard.press('End');
  await expect(start).toHaveValue('6');
  await expect(summary).toContainText('1 day');
  expect(await axeViolations(page)).toEqual([]);

  // Collapsed with a range set: the toggle shows the range; reopening keeps it; All clears it.
  await page.getByRole('button', { name: /^\d{2}\/\d{2}\/\d{2} → \d{2}\/\d{2}\/\d{2}$/ }).click();
  await expect(range).toHaveCount(0);
  await page.getByRole('button', { name: /→/ }).click();
  await expect(start).toHaveValue('6');
  await all.click();
  await expect(start).toHaveValue('0');
  await expect(summary).toContainText(`${total} days`);
  await expect(page.getByRole('button', { name: 'Filter dates' })).toBeVisible();
});

test('a11y: header still fits 375 px with a wallet connected (Sign in + account button)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/obligations');
  await waitForSettled(page);
  // Connecting the mock wallet is local to this page: no chain writes, no sign-in.
  await page.waitForFunction(() => window.__runwaymindE2E?.ready === true);
  await page.evaluate(() => window.__runwaymindE2E!.connect());
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `connected header overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.__runwaymindE2E!.disconnect());
});

test('pools: history tabs switch between Safety score and APY & Utilization (mouse + keyboard)', async ({ page }) => {
  await page.goto('/pools');
  await waitForSettled(page);
  const card = page.getByRole('article').first();
  const tablist = card.getByRole('tablist', { name: 'Pool history chart' });
  const score = tablist.getByRole('tab', { name: 'Safety score' });
  const metrics = tablist.getByRole('tab', { name: 'APY & Utilization' });
  await expect(score).toHaveAttribute('aria-selected', 'true');
  await metrics.click();
  await expect(metrics).toHaveAttribute('aria-selected', 'true');
  await expect(card.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', (await metrics.getAttribute('id'))!);
  await metrics.press('ArrowLeft');
  await expect(score).toHaveAttribute('aria-selected', 'true');
  await expect(score).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);
});

test('agent activity: paginated 10 per page; filter resets to page 1 (mocked list of 23 items)', async ({ page }) => {
  // Test data only has a few items, so the list is replaced with 23 synthetic keeper runs / decisions.
  const items = Array.from({ length: 23 }, (_, i) =>
    i % 2 === 0
      ? { type: 'KEEPER_RUN', at: 1_794_700_000 - i * 60, id: `k${i}`, data: { paidIds: [], enforced: false, txHashes: [] } }
      : { type: 'DECISION', at: 1_794_700_000 - i * 60, id: `d${i}`, data: { action: 'HOLD', status: 'SKIPPED', explanation: { headline: `Decision ${i}` } } },
  );
  await page.route(/\/api\/v1\/agent\/activity/, (route) => route.fulfill({ json: { success: true, error: null, meta: { requestId: 'e2e' }, data: items } }));
  await page.goto('/agent');
  await waitForSettled(page);
  const timeline = page.getByRole('region', { name: 'Activity timeline' });
  const pager = timeline.getByRole('navigation', { name: 'Activity pages' });
  await expect(timeline.getByRole('listitem')).toHaveCount(10);
  await expect(pager.getByTestId('activity-range')).toHaveText('1–10 of 23');
  await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await pager.getByRole('button', { name: 'Next' }).click();
  await pager.getByRole('button', { name: 'Next' }).click();
  await expect(pager).toContainText('Page 3 of 3');
  await expect(timeline.getByRole('listitem')).toHaveCount(3);
  await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled();

  await timeline.getByRole('button', { name: 'DECISION' }).click(); // 11 decisions → back to page 1
  await expect(pager.getByTestId('activity-range')).toHaveText('1–10 of 11');
  await expect(pager).toContainText('Page 1 of 2');
  expect(await axeViolations(page)).toEqual([]);
});

test('settings: Add adapter checks the address on-chain before it can be signed (Anvil E2E deployment)', async ({ page }) => {
  const ADAPTER = '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6'; // the listed VaultAdapter
  const MOCK_USDC = '0x5FbDB2315678afecb367f032d93F642f64180aa3'; // a real contract that is not an adapter
  await page.goto('/settings');
  await waitForSettled(page);
  // Hidden until opened.
  const form = page.getByRole('form', { name: 'Add adapter' });
  await expect(form).toHaveCount(0);
  const opener = page.getByRole('button', { name: 'Add adapter' });
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.click();
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Adapter address')).toBeFocused();
  const input = form.getByLabel('Adapter address');
  const check = form.getByTestId('add-adapter-check');
  const add = form.getByRole('button', { name: 'Add adapter' });
  await expect(form).toContainText('1 of 5 used');
  await expect(add).toBeDisabled();

  await input.fill('0x1234');
  await expect(check).toContainText('0x followed by 40 hex characters');
  await input.fill(ADAPTER.toLowerCase());
  await expect(check).toContainText('already in the whitelist');
  await input.fill(MOCK_USDC);
  await expect(check).toContainText('Not a complete vault adapter', { timeout: 15_000 });
  await expect(check).toContainText('treasury');
  await input.fill('0x000000000000000000000000000000000000dEaD');
  await expect(check).toContainText('No vault adapter found', { timeout: 15_000 });
  await expect(add).toBeDisabled();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await axeViolations(page)).toEqual([]);

  // Cancel closes and clears; reopening starts empty.
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: 'Add adapter' }).click();
  await expect(page.getByRole('form', { name: 'Add adapter' }).getByLabel('Adapter address')).toHaveValue('');
});
