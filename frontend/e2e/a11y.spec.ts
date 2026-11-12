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

for (const route of APP_ROUTES) {
  test(`a11y: ${route.href} has no WCAG A/AA axe violations (wallet not connected)`, async ({ page }) => {
    await page.goto(route.href);
    await waitForSettled(page);
    // Read-only view: admin controls are explained by a visible, keyboard-reachable notice (docs/08 §8).
    expect(await axeViolations(page)).toEqual([]);
  });
}

test('a11y: every route fits 375 px without horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of APP_ROUTES) {
    await page.goto(route.href);
    await waitForSettled(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route.href} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test('a11y: DEMO MODE banner is visible on load and a skip link reaches main content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-mode-banner')).toBeVisible();
  await expect(page.getByTestId('demo-mode-banner')).toContainText(/Demo mode/i);
  await expect(page.getByTestId('demo-mode-banner')).toContainText(/Day \d+/);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});
