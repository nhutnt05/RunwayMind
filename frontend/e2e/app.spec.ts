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

test('obligation creation: list → Create obligation page → form → sign (mock wallet on Anvil) → row appears after receipt', async () => {
  await page.goto('/obligations');
  await signIn();
  // The list page no longer embeds the creation tools; they live on /obligations/new.
  await expect(page.getByRole('form', { name: 'Create obligation' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Natural language input' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Create obligation' }).click();
  await expect(page).toHaveURL(/\/obligations\/new$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create Obligation');
  await expect(page.locator('nav[aria-label="Main"] a[aria-current="page"]').first()).toHaveAttribute('href', '/obligations');
  const form = page.getByRole('form', { name: 'Create obligation' });
  await form.getByLabel('Label').fill('E2E vendor invoice');
  await form.getByLabel('Category').selectOption('VENDOR_INVOICE');
  await form.getByLabel('Recipient address').fill(R6);
  await form.getByLabel('Amount (USDC)').fill('1234');
  await form.getByLabel(/First due date/).fill(isoInDays(60)); // outside the 14-day horizon: reserve stays 30,000
  await form.getByLabel(/Notes/).fill('Invoice INV-42\nPay to vendor <b>Acme</b>');
  await form.getByRole('button', { name: 'Create & sign' }).click();
  await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 60_000 });
  const created = page.getByRole('status').filter({ hasText: 'created on-chain' });
  await expect(created).toContainText('E2E vendor invoice', { timeout: 60_000 });
  await created.getByRole('link', { name: 'View obligations' }).click();
  await expect(page).toHaveURL(/\/obligations$/);
  await expect(page.getByRole('cell', { name: /E2E vendor invoice/ }).first()).toBeVisible({ timeout: 60_000 });
});

test('cancel obligation: custom dialog (no native confirm) → Keep/Esc send nothing → double-click cancels once on-chain', async () => {
  await page.goto('/obligations');
  await signIn();
  let nativeDialogs = 0;
  const onNative = (d: { dismiss: () => Promise<void> }) => {
    nativeDialogs++;
    void d.dismiss();
  };
  page.on('dialog', onNative);
  const cancelPosts: string[] = [];
  const onRequest = (r: { url: () => string; method: () => string }) => {
    if (r.method() === 'POST' && /\/obligations\/[^/]+\/cancel/.test(r.url())) cancelPosts.push(r.url());
  };
  page.on('request', onRequest);
  try {
    const row = page.getByRole('row').filter({ hasText: 'E2E vendor invoice' });

    // 0) Note column: the icon opens a popup with the note as plain text (line break kept, markup not rendered).
    await row.getByRole('button', { name: 'View note for E2E vendor invoice' }).click();
    const note = page.getByTestId('obligation-note-dialog');
    await expect(page.getByRole('dialog', { name: 'Note' })).toBeVisible();
    await expect(note).toContainText('Invoice INV-42');
    await expect(note).toContainText('Pay to vendor <b>Acme</b>');
    await expect(note.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(note).toBeHidden();
    // A seeded obligation without a note shows "—" and no button.
    const plain = page.getByRole('row').filter({ hasText: 'November payroll' });
    await expect(plain.getByLabel('No note')).toBeVisible();
    await expect(plain.getByRole('button', { name: /View note/ })).toHaveCount(0);

    const openDialog = () => row.getByRole('button', { name: /Cancel obligation E2E vendor invoice/ }).click();
    const dialog = page.getByTestId('cancel-obligation-dialog');

    // 1) Review: real obligation data + on-chain notice; the safe action has focus. Keep closes without a request.
    await openDialog();
    await expect(page.getByRole('dialog', { name: 'Cancel Obligation' })).toBeVisible();
    await expect(dialog).toContainText('E2E vendor invoice');
    await expect(dialog).toContainText('1,234.00');
    await expect(dialog).toContainText('On-chain Action');
    await expect(dialog.getByRole('button', { name: 'Keep Obligation' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep Obligation' }).click();
    await expect(dialog).toBeHidden();

    // 2) Esc also closes without a request.
    await openDialog();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(cancelPosts).toHaveLength(0);
    await expect(row).toBeVisible();

    // 3) Double-click "Cancel Obligation": exactly one cancellation flow, confirmed on-chain.
    await openDialog();
    await dialog.getByRole('button', { name: 'Cancel Obligation' }).dblclick();
    await expect(dialog).toHaveAttribute('data-phase', 'success', { timeout: 60_000 });
    await expect(dialog).toContainText('Obligation cancelled successfully.');
    await expect(dialog.getByRole('link', { name: /View on Snowtrace/ })).toHaveAttribute('href', /\/tx\/0x[0-9a-f]{64}$/);
    expect(cancelPosts).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: /E2E vendor invoice/ })).toHaveCount(0, { timeout: 30_000 });
    expect(nativeDialogs).toBe(0);
  } finally {
    page.off('dialog', onNative);
    page.off('request', onRequest);
  }
});

test('edit notes only: saved off-chain without a signature; due date (with a time of day) unchanged', async () => {
  await page.goto('/obligations');
  await signIn();
  const writes: string[] = [];
  const onRequest = (r: { url: () => string; method: () => string }) => {
    // Any prepared on-chain update is registered via POST /transactions after signing.
    if (r.method() === 'POST' && /\/api\/v1\/transactions(\?|$)/.test(r.url())) writes.push(r.url());
  };
  page.on('request', onRequest);
  try {
    const row = page.getByRole('row').filter({ hasText: 'Q1 grant' });
    const dueBefore = (await row.getByRole('cell').nth(5).textContent()) ?? '';
    await row.getByRole('button', { name: /Edit obligation Q1 grant/ }).click();
    const form = page.getByRole('form', { name: /Edit obligation/ });
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled(); // nothing changed yet
    await form.getByLabel('Notes').fill('Grant tranche 1 of 3');
    await expect(form.getByTestId('edit-signature-hint')).toHaveText(/saved off-chain: no wallet signature needed/);
    await expect(form.getByRole('button', { name: 'Save & sign' })).toHaveCount(0);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    await row.getByRole('button', { name: 'View note for Q1 grant' }).click();
    await expect(page.getByTestId('obligation-note-dialog')).toContainText('Grant tranche 1 of 3');
    await page.keyboard.press('Escape');
    expect(writes).toHaveLength(0);
    await expect(row.getByRole('cell').nth(5)).toHaveText(dueBefore);

    // Changing an on-chain field switches the action to a signed update (not submitted here).
    await row.getByRole('button', { name: /Edit obligation Q1 grant/ }).click();
    await form.getByLabel('Amount (USDC)').fill('10001');
    await expect(form.getByRole('button', { name: 'Save & sign' })).toBeVisible();
    await form.getByRole('button', { name: 'Close' }).click();
  } finally {
    page.off('request', onRequest);
  }
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

  await page.goto('/obligations/new');
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

test('agent mode: custom dialog (no native confirm); Esc and "Stay in APPROVE" send nothing', async () => {
  await page.goto('/agent');
  await signIn();
  let nativeDialogs = 0;
  const onNative = (d: { dismiss: () => Promise<void> }) => {
    nativeDialogs++;
    void d.dismiss();
  };
  const puts: string[] = [];
  const onRequest = (r: { url: () => string; method: () => string }) => {
    if (r.method() === 'PUT' && r.url().includes('/agent/settings')) puts.push(r.url());
  };
  page.on('dialog', onNative);
  page.on('request', onRequest);
  try {
    const modeCard = page.getByRole('region', { name: 'Agent mode' });
    const open = modeCard.getByRole('button', { name: 'Switch to AUTO' }); // shown only while the mode is APPROVE
    await expect(open).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Switch to AUTO mode?' });

    await open.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('R1–R6');
    await expect(dialog.getByRole('button', { name: 'Stay in APPROVE' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused(); // focus returns to the opener

    await open.click();
    await dialog.getByRole('button', { name: 'Stay in APPROVE' }).click();
    await expect(dialog).toBeHidden();
    await expect(open).toBeVisible(); // still APPROVE
    expect(puts).toEqual([]);
    expect(nativeDialogs).toBe(0);
  } finally {
    page.off('dialog', onNative);
    page.off('request', onRequest);
  }
});

test('error toast (mocked rejected prepare): closes after ~5 s, stays while hovered, ✕ closes at once', async () => {
  await page.goto('/settings');
  await signIn();
  // Nothing reaches the chain: the backend prepare is mocked to report a rejected simulation.
  // Regex, not a glob: the real request carries ?treasury=… and must not slip through to the chain.
  const PREPARE = /\/api\/v1\/policy\/prepare(\?|$)/;
  await page.route(PREPARE, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        error: null,
        meta: { requestId: 'e2e' },
        data: {
          preparedTx: { to: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', data: '0x', value: '0', chainId: 31337, contract: 'PolicyEngine', functionName: 'setSafetyHorizon' },
          simulation: { ok: false, error: { name: 'InsufficientPoolLiquidity', args: {} } },
        },
      }),
    }),
  );
  const policy = page.getByRole('region', { name: 'Policy' });
  const failed = page.locator('[data-testid="tx-toast"][data-status="FAILED"]');
  try {
    // 1) Auto-close after ~5 s.
    await policy.getByLabel('Safety horizon days').fill('15');
    await policy.getByRole('button', { name: 'Save' }).first().click();
    await expect(failed).toContainText('InsufficientPoolLiquidity');
    await page.mouse.move(0, 0);
    await expect(failed).toBeHidden({ timeout: 8_000 });

    // 2) Hover pauses it; leaving restarts the 5 s.
    await policy.getByRole('button', { name: 'Save' }).first().click();
    await expect(failed).toBeVisible();
    await failed.hover();
    await page.waitForTimeout(6_500);
    await expect(failed).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(failed).toBeVisible(); // restarted, not closed at once
    await expect(failed).toBeHidden({ timeout: 8_000 });

    // 3) ✕ closes immediately.
    await policy.getByRole('button', { name: 'Save' }).first().click();
    await failed.getByRole('button', { name: /Dismiss/ }).click();
    await expect(failed).toHaveCount(0);
  } finally {
    await page.unroute(PREPARE);
  }
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
