// TEMPORARY (reference demo video, deleted afterwards). Drives the real app on the local E2E stack (Anvil 8547,
// mock wallet) scene by scene, records the browser, and writes when each scene starts so narration can be aligned.
import { spawn } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const OUT = process.env.VIDEO_DIR!;
const durations = JSON.parse(readFileSync(resolve(OUT, 'durations.json'), 'utf8')) as Record<string, number>;
const ROOT = resolve(process.cwd(), '..'); // tests run from frontend/

test.setTimeout(15 * 60_000);

async function settled(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[aria-busy="true"], [data-testid="skeleton-grid"]')).toHaveCount(0, { timeout: 60_000 });
}

/** 127.0.0.1:8545 → 8547 so `pnpm demo:attack --network local` reaches the E2E chain. */
function proxy8545(): Promise<Server> {
  return new Promise((ok) => {
    const s = createServer((c) => {
      const u = connect(8547, '127.0.0.1');
      c.pipe(u).pipe(c);
      c.on('error', () => u.destroy());
      u.on('error', () => c.destroy());
    });
    s.listen(8545, '127.0.0.1', () => ok(s));
  });
}

test('reference demo video', async ({ browser }) => {
  // Warm-up (not recorded): compile every page once so the recording has no dev-server pauses.
  const warm = await browser.newPage();
  for (const r of ['/', '/obligations', '/cash-ladder', '/vault', '/pools', '/agent', '/transactions', '/settings']) {
    await warm.goto(r);
    await settled(warm);
  }
  await warm.close();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const timeline: { id: string; start: number }[] = [];
  const scene = async (id: string, body: () => Promise<void>) => {
    const start = Date.now();
    timeline.push({ id, start: (start - t0) / 1000 });
    writeFileSync(resolve(OUT, 'timeline.json'), JSON.stringify({ total: null, timeline }, null, 1));
    await body();
    const left = (durations[id] ?? 0) * 1000 + 700 - (Date.now() - start);
    if (left > 0) await page.waitForTimeout(left);
  };

  // S1 — intro on the dashboard; connect the (mock) ADMIN wallet and sign in.
  await scene('s1', async () => {
    await page.goto('/');
    await settled(page);
    await page.waitForFunction(() => window.__runwaymindE2E?.ready === true);
    await page.evaluate(() => window.__runwaymindE2E!.connect());
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: /ADMIN · Sign out/ })).toBeVisible();
  });

  // S2 — obligations.
  await scene('s2', async () => {
    await page.getByRole('link', { name: 'Obligation Management', exact: true }).first().click();
    await settled(page);
    await expect(page.getByRole('cell', { name: 'November payroll', exact: true })).toBeVisible();
  });

  // S3 — cash ladder.
  await scene('s3', async () => {
    await page.getByRole('link', { name: 'Cash Ladder', exact: true }).first().click();
    await settled(page);
    await page.waitForTimeout(3500);
    await page.mouse.wheel(0, 380);
  });

  // S4 — agent recommends investing 70,000 → approve → executed.
  await scene('s4', async () => {
    await page.getByRole('link', { name: 'AI Agent Activity', exact: true }).first().click();
    await settled(page);
    await page.getByRole('button', { name: 'Evaluate now' }).click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await settled(page);
    const card = page.locator('article[data-status]').filter({ hasText: '70,000.00' }).first();
    await expect(card).toHaveAttribute('data-status', 'PENDING_APPROVAL', { timeout: 60_000 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(4000);
    await card.getByRole('button', { name: 'Approve' }).click();
    await page.mouse.wheel(0, -2000);
    await expect(page.getByRole('region', { name: 'In Yield Vault' })).toContainText(/69,999\.\d\d|70,000/, { timeout: 90_000 });
  });

  // S5 — over-investing is blocked by R1.
  await scene('s5', async () => {
    await page.getByRole('link', { name: 'Yield Vault', exact: true }).first().click();
    await settled(page);
    const card = page.getByRole('article', { name: /Mock Lending Pool/ });
    await card.getByRole('button', { name: 'Invest' }).click();
    await card.getByLabel('Amount (USDC)').fill('10000');
    await page.waitForTimeout(1200);
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card.getByRole('alert')).toContainText('Blocked by R1', { timeout: 30_000 });
  });

  // S6 — +7 days: the keeper pays November payroll at once.
  await scene('s6', async () => {
    await page.getByRole('link', { name: 'Settings & Policy Configuration', exact: true }).first().click();
    await settled(page);
    const demo = page.getByRole('region', { name: 'Demo controls' });
    await demo.scrollIntoViewIfNeeded();
    await demo.getByRole('button', { name: '+7 days' }).click();
    await expect(page.getByTestId('tx-toast').filter({ hasText: 'Keeper: pay what is now due' })).toContainText(/Paid #1(?!\d)/, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await page.getByRole('link', { name: 'Transaction History', exact: true }).first().click();
    await settled(page);
  });

  // S7 — hacked-agent script, run live against the same chain; its real output is shown as a terminal.
  await scene('s7', async () => {
    await page.setContent(
      `<html><body style="margin:0;background:#0b1020;color:#d1e7ff;font:16px/1.5 Consolas,monospace;padding:28px">
       <div style="color:#7dd3fc">PS D:\\RunwayMind&gt; pnpm demo:attack --network local</div><pre id="o" style="white-space:pre-wrap;margin:8px 0 0"></pre></body></html>`,
    );
    const srv = await proxy8545();
    try {
      await new Promise<void>((done) => {
        const p = spawn('pnpm', ['demo:attack', '--network', 'local'], { cwd: ROOT, shell: true });
        const push = async (b: Buffer) => {
          const text = b.toString().replace(/\x1b\[[0-9;]*m/g, '');
          await page.evaluate((t) => {
            const o = document.getElementById('o')!;
            o.textContent += t;
            window.scrollTo(0, document.body.scrollHeight);
          }, text).catch(() => undefined);
        };
        p.stdout.on('data', push);
        p.stderr.on('data', push);
        p.on('close', () => done());
      });
    } finally {
      srv.close();
    }
    await page.waitForTimeout(3000);
  });

  // S7b — AUTO mode: APY drops below the 3 % minimum → the agent withdraws by itself (no approval).
  await scene('s7b', async () => {
    await page.goto('/agent');
    await settled(page);
    const modeCard = page.getByRole('region', { name: 'Agent mode' });
    await modeCard.getByRole('button', { name: 'Switch to AUTO' }).click();
    const dialog = page.getByRole('dialog', { name: 'Switch to AUTO mode?' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(1500);
    await dialog.getByRole('button', { name: 'Switch to AUTO' }).click();
    await expect(modeCard.getByRole('button', { name: 'Switch to APPROVE' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);

    await page.getByRole('link', { name: 'Settings & Policy Configuration', exact: true }).first().click();
    await settled(page);
    const demo = page.getByRole('region', { name: 'Demo controls' });
    await demo.scrollIntoViewIfNeeded();
    await demo.locator('#demo-apy').fill('100'); // 1.00 %
    await page.waitForTimeout(800);
    await demo.getByRole('button', { name: 'Apply pool APY' }).click();
    await expect
      .poll(async () => {
        const r = await page.request.get('http://localhost:4100/api/v1/pools?treasury=local-musdc');
        return ((await r.json()) as { data: { apyBps: number }[] }).data[0]?.apyBps;
      }, { timeout: 60_000, intervals: [1000] })
      .toBe(100);

    await page.getByRole('link', { name: 'AI Agent Activity', exact: true }).first().click();
    await settled(page);
    await page.getByRole('button', { name: 'Evaluate now' }).click();
    // The agent executes on its own: wait until the vault is actually empty on-chain.
    await expect
      .poll(async () => {
        const r = await page.request.get('http://localhost:4100/api/v1/treasury/overview?treasury=local-musdc');
        return BigInt(((await r.json()) as { data: { vaultTotal: string } }).data.vaultTotal) < 10_000n;
      }, { timeout: 90_000, intervals: [1500] })
      .toBe(true);
    // No reload (it would drop the mock wallet): the activity list refetches every 5 s on its own.
    await expect(
      page.getByRole('region', { name: 'Activity timeline' }).getByRole('listitem').filter({ hasText: /Withdraw 70,?\d{3}\.\d\d/ }).filter({ hasText: 'EXECUTED' }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
  });

  // S8 — pause the pool → Pool Risk turns CRITICAL.
  await scene('s8', async () => {
    await page.goto('/settings');
    await settled(page);
    const demo = page.getByRole('region', { name: 'Demo controls' });
    await demo.scrollIntoViewIfNeeded();
    // Controlled checkbox: it flips only after the setPaused tx confirms, so click (not check()).
    await demo.getByLabel('Pool paused').click();
    await expect(page.getByTestId('tx-toast').filter({ hasText: 'Pause pool' })).toHaveAttribute('data-status', 'CONFIRMED', { timeout: 60_000 });
    // Stay on Settings (the "Pause pool ✓" toast) until the API reports the paused pool at score 0, then open Pool
    // Risk once: it loads fresh data, so the gauge shows 0 / Critical with no reload or loading placeholders.
    await expect
      .poll(async () => {
        const r = await page.request.get('http://localhost:4100/api/v1/pools?treasury=local-musdc');
        return ((await r.json()) as { data: { riskScore: number }[] }).data[0]?.riskScore;
      }, { timeout: 60_000, intervals: [1000] })
      .toBe(0);
    await page.getByRole('link', { name: 'Pool Risk Dashboard', exact: true }).first().click();
    await expect(page.getByRole('img', { name: /Safety score 0 out of 100/ })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3500); // hold on the 0 / Critical gauge
  });

  // S9 — closing on the dashboard.
  await scene('s9', async () => {
    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await settled(page);
  });

  const total = (Date.now() - t0) / 1000;
  const video = page.video()!;
  await ctx.close();
  copyFileSync(await video.path(), resolve(OUT, 'screen.webm'));
  writeFileSync(resolve(OUT, 'timeline.json'), JSON.stringify({ total, timeline }, null, 1));
});
