// docs/10 §6 E2E on Anvil (real chain + real backend + agent), driven through wagmi's mock connector
// (NEXT_PUBLIC_E2E=true). Specs share one page and run in order: later specs depend on the chain state of earlier ones.
import { expect, test, type Page } from '@playwright/test';
import { mnemonicToAccount } from 'viem/accounts';

const R6 = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 6 }).address;
const isoInDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

async function e2eConnect(chainId?: number) {
  await page.waitForFunction(() => window.__runwaymindE2E?.ready === true);
  await page.evaluate((id) => window.__runwaymindE2E!.connect(id), chainId);
}

async function signIn() {
  await e2eConnect();
  const signOut = page.getByRole('button', { name: /Sign out/ });
  if (await signOut.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /ADMIN · Sign out/ })).toBeVisible();
}

test('wallet connection: wrong network shows banner + switch; connected address shown', async () => {
  await page.goto('/');
  await e2eConnect(43113); // Fuji ≠ Anvil (31337) → wrong network
  const banner = page.getByRole('alert').filter({ hasText: 'Wrong network' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /Switch to/ }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByText(/0xf3.{0,4}2266/).first()).toBeVisible();
});

test('dashboard renders SRC day-0 data from the backend', async () => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total assets' })).toContainText('100,000.00');
  await expect(page.getByRole('region', { name: 'Idle (Liquidity Reserve)' })).toContainText('Required: 30,000.00');
  await expect(page.getByRole('region', { name: 'Runway meter' })).toContainText('365+ days');
});

test('responsive: dashboard at 375 px has no horizontal scroll', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Total assets' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('obligation creation: form → prepare → sign (mock wallet on Anvil) → row appears after receipt', async () => {
  await page.goto('/obligations');
  await signIn();
  const form = page.getByRole('form', { name: 'Create obligation' });
  await form.getByLabel('Label').fill('E2E vendor invoice');
  await form.getByLabel('Category').selectOption('VENDOR_INVOICE');
  await form.getByLabel('Recipient address').fill(R6);
  await form.getByLabel('Amount (USDC)').fill('1234');
  await form.getByLabel(/First due date/).fill(isoInDays(60)); // outside the 14-day horizon: reserve stays 30,000
  await form.getByRole('button', { name: 'Create & sign' }).click();
  await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('cell', { name: /E2E vendor invoice/ }).first()).toBeVisible({ timeout: 60_000 });
});

test('NL flow: parse (mocked API) → edit draft → confirm & sign on Anvil', async () => {
  const due = Math.floor(Date.now() / 1000) + 70 * 86_400;
  await page.route('**/api/v1/obligations/parse**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        error: null,
        meta: { requestId: 'e2e' },
        data: {
          drafts: [
            {
              draftId: 'drf_e2e',
              label: 'Hosting',
              category: 'VENDOR_INVOICE',
              recipient: R6,
              amount: '500000000',
              firstDueDate: due,
              interval: 0,
              maxOccurrences: 1,
              warnings: [],
              sourceSpan: `hosting 500 USDC cho ${R6} sau 70 ngày`,
            },
          ],
          needsClarification: [],
          llm: { provider: 'mock', latencyMs: 1 },
        },
      }),
    }),
  );
  // The mocked draft id does not exist in the backend DB: forward the real prepare without nlDraftId.
  await page.route(/\/api\/v1\/obligations(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    return route.continue({ postData: JSON.stringify({ ...body, nlDraftId: null }) });
  });

  await page.goto('/obligations');
  await signIn();
  const nl = page.getByRole('region', { name: 'Natural language input' });
  await nl.getByLabel('Obligation description').fill(`hosting 500 USDC cho ${R6} sau 70 ngày`);
  await nl.getByRole('button', { name: 'Create drafts' }).click();
  const draft = nl.getByRole('list', { name: 'Draft review' }).getByRole('listitem').first();
  await expect(draft.getByLabel('Label')).toHaveValue('Hosting');
  await draft.getByLabel('Label').fill('E2E hosting (NL)');
  await draft.getByRole('button', { name: 'Confirm & sign' }).click();
  await expect(draft.getByRole('button', { name: 'Created ✓' })).toBeVisible({ timeout: 60_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('reverted call shows the decoded error: invest 90,000 → Blocked by R1 Reserve Ratio', async () => {
  await page.goto('/vault');
  await signIn();
  const card = page.getByRole('article', { name: /Mock Lending Pool/ });
  await card.getByRole('button', { name: 'Invest' }).click();
  await card.getByLabel('Amount (USDC)').fill('90000');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card.getByRole('alert')).toContainText('Blocked by R1 Reserve Ratio: idle after 10,000.00 < required 30,000.00');
});

test('approval flow: evaluate → pending INVEST 70,000 → Approve → EXECUTED with Snowtrace link', async () => {
  await page.goto('/agent');
  await signIn();
  await page.getByRole('button', { name: 'Evaluate now' }).click();
  await page.goto('/');
  const card = page.locator('article[data-status]').filter({ hasText: '70,000.00' }).first();
  await expect(card).toHaveAttribute('data-status', 'PENDING_APPROVAL', { timeout: 60_000 });
  await card.getByRole('button', { name: 'Approve' }).click();
  // The list only shows pending items; follow the decision on the agent timeline.
  await page.goto('/agent');
  const executed = page.getByRole('listitem').filter({ hasText: 'EXECUTED' }).filter({ hasText: '70,000.00' }).first();
  await expect(executed).toBeVisible({ timeout: 90_000 });
  const link = page.getByRole('link', { name: /on Snowtrace/ }).first();
  await expect(link).toHaveAttribute('href', /https:\/\/testnet\.snowtrace\.io\/tx\/0x[0-9a-f]{64}/);
});

test('treasury switcher (mocked GET /treasuries): visible with two treasuries; selection is sent as ?treasury=', async () => {
  const t = (id: string, isPrimary: boolean, treasuryAddress: string) => ({
    id,
    chainId: 31337,
    isPrimary,
    treasuryAddress,
    registryAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    policyAddress: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    assetAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    assetSymbol: isPrimary ? 'mUSDC' : 'USDC',
    assetDecimals: 6,
    demoStartTime: 1,
    deployBlock: '0',
    poolAddress: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    adapterAddress: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  });
  await page.route('**/api/v1/treasuries**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        error: null,
        meta: { requestId: 'e2e' },
        data: [t('local-musdc', true, '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'), t('local-usdc', false, '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9')],
      }),
    }),
  );
  await page.goto('/');
  const switcher = page.getByTestId('treasury-switcher');
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveValue('local-musdc');
  const sent = page.waitForRequest((r) => r.url().includes('/api/v1/treasury/overview') && r.url().includes('treasury=local-usdc'));
  await switcher.selectOption('local-usdc');
  await sent;
  expect(await page.evaluate(() => localStorage.getItem('runwaymind.treasury'))).toBe('local-usdc');
  await switcher.selectOption('local-musdc');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
