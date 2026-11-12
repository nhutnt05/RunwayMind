// D5 endpoints: pools / Pool Risk (docs/07 §4.4), runway + stress tests (§4.5), inflows (§4.6), NL parse (§5.4).
import type { LlmProvider } from '@runwaymind/agent';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADAPTER, DAY, FakeChain, T0, USDC, loginCookie, makeApp, prisma, resetDb } from './helpers';

const admin = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());
const API = '/api/v1';
const R1 = '0x0000000000000000000000000000000000000001';
const R2 = '0x0000000000000000000000000000000000000002';
const R3 = '0x0000000000000000000000000000000000000003';
const iso = (days: number) => new Date((T0 + days * DAY) * 1000).toISOString().slice(0, 10);
const ob = (label: string, category: string, recipient: string, amount: string, days: number) => ({
  label,
  category,
  recipient,
  amount,
  currency: 'USDC',
  firstDueDate: iso(days),
  recurrence: { type: 'NONE', everyNDays: null, occurrences: null },
  sourceSpan: label,
});

/** Mock LLM returning the docs/12 scene 0:20 drafts (no network). */
const demoProvider = (): LlmProvider => ({
  name: 'mock',
  completeJson: async () =>
    JSON.stringify({
      obligations: [
        ob('November payroll', 'PAYROLL', R1, '20000', 7),
        ob('December payroll', 'PAYROLL', R2, '20000', 30),
        ob('Grant', 'GRANT', R3, '10000', 45),
      ],
      needsClarification: [],
    }),
});
const DEMO_TEXT = `Trả lương tháng 11 20k USDC cho ${R1} sau 7 ngày, lương tháng 12 20k cho ${R2} sau 30 ngày, grant 10k cho ${R3} sau 45 ngày`;

async function setup(opts: { llm?: LlmProvider | null; nowMs?: () => number } = {}) {
  const chain = new FakeChain();
  chain.admins.add(admin.address);
  const built = await makeApp(chain, undefined, {
    llm: { provider: opts.llm === undefined ? demoProvider() : opts.llm, timeoutMs: 1_000 },
    ...(opts.nowMs ? { nowMs: opts.nowMs } : {}),
  });
  const adminCookie = await loginCookie(built.app, admin);
  const viewerCookie = await loginCookie(built.app, viewer);
  const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, cookie?: string) =>
    built.app.inject({ method, url: `${API}${url}`, ...(cookie ? { headers: { cookie } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { ...built, chain, adminCookie, viewerCookie, req };
}

describe('pools / Pool Risk (docs/07 §4.4)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('GET /pools → adapters with riskScore + band (SRC day 0: 87 HEALTHY)', async () => {
    const { req } = await setup();
    const res = await req('GET', '/pools');
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ address: ADAPTER, riskScore: 87, band: 'HEALTHY', tvl: '10000000000' });
  });

  it('GET /pools/:adapter/risk uses stored APY history; GET /pools/:adapter returns samples + risk history', async () => {
    const { req, store, chain } = await setup();
    const a = chain.snapshot.adapters[0]!;
    // 19 stored samples at 8% (+ the live 1% sample) and utilization 98%, cash 80,030 → docs/06 §4.3 crisis = 22.
    const samples = Array.from({ length: 19 }, (_, i) => ({ adapterAddress: ADAPTER, sampledAt: T0 - (i + 1) * 60, blockNumber: 1n, apyBps: 800, utilizationBps: 5000, tvl: USDC(80_000), availableLiquidity: USDC(80_000), paused: false }));
    await store.savePoolMetrics('snap-hist', chain.snapshot.adapters, samples, []);
    chain.snapshot = { ...chain.snapshot, adapters: [{ ...a, apyBps: 100, utilizationBps: 9800, tvl: 80_030_000_000n }] };

    const risk = await req('GET', `/pools/${ADAPTER}/risk`);
    expect(risk.statusCode).toBe(200);
    expect(risk.json().data).toMatchObject({ score: 22, band: 'CRITICAL', samplesUsed: 20, components: { utilization: 12, apyVolatility: 12.5 } });

    const detail = await req('GET', `/pools/${ADAPTER}`);
    expect(detail.json().data.samples).toHaveLength(19);
    expect(detail.json().data.samples[0]).toMatchObject({ apyBps: 800, tvl: '80000000000' });
    expect(detail.json().data.riskScore).toBe(22);

    expect((await req('GET', '/pools/0x00000000000000000000000000000000000000ff/risk')).statusCode).toBe(404);
    expect((await req('GET', '/pools/not-an-address')).statusCode).toBe(400);
  });
});

describe('runway + stress tests (docs/07 §4.5)', () => {
  beforeEach(resetDb);

  it('POST /stress-tests (session) → baseline + 4 scenarios, persisted; GET by id / list; GET /runway shows worst case', async () => {
    const { req, viewerCookie, chain } = await setup();
    // docs/06 §3.5 table = SRC Day 0 after investing 70,000 (idle 30,000, vault 70,000).
    const a = chain.snapshot.adapters[0]!;
    chain.snapshot = { ...chain.snapshot, idle: USDC(30_000), adapters: [{ ...a, balance: USDC(70_000), tvl: USDC(80_000), availableLiquidity: USDC(80_000) }] };
    expect((await req('POST', '/stress-tests', {})).statusCode).toBe(401);
    const run = await req('POST', '/stress-tests', {}, viewerCookie);
    expect(run.statusCode).toBe(200);
    const data = run.json().data;
    expect(data.scenarios.map((s: { id: string }) => s.id)).toEqual(['APY_DROP_50', 'POOL_LOCK_14D', 'INFLOW_DELAY_30D', 'EXPENSE_PLUS_20']);
    expect(data).toMatchObject({ worstCase: 'EXPENSE_PLUS_20', overallClassification: 'WATCH', baseline: { id: 'BASELINE' } });
    expect(data.scenarios[3].recommendedAction).toMatchObject({ action: 'WITHDRAW', amount: '4000000000' });

    expect((await req('GET', `/stress-tests/${data.id}`)).json().data.worstCase).toBe('EXPENSE_PLUS_20');
    expect((await req('GET', '/stress-tests?limit=5')).json().data).toHaveLength(1);
    expect((await req('GET', '/stress-tests/nope')).statusCode).toBe(404);

    const runway = (await req('GET', '/runway')).json().data;
    expect(runway).toMatchObject({ baseline: { runwayDays: 365, capped: true }, worstCase: { id: 'EXPENSE_PLUS_20' }, lastStressTestId: data.id });
  });

  it('POST /stress-tests with a scenario subset; invalid scenario → 400', async () => {
    const { req, viewerCookie } = await setup();
    const run = await req('POST', '/stress-tests', { scenarios: ['APY_DROP_50'] }, viewerCookie);
    expect(run.json().data.scenarios.map((s: { id: string }) => s.id)).toEqual(['APY_DROP_50']);
    expect((await req('POST', '/stress-tests', { scenarios: ['NOPE'] }, viewerCookie)).statusCode).toBe(400);
  });

  it('GET /runway before any stress test → worstCase null', async () => {
    const { req } = await setup();
    expect((await req('GET', '/runway')).json().data).toMatchObject({ worstCase: null, lastStressTestId: null });
  });
});

describe('expected inflows (docs/07 §4.6)', () => {
  beforeEach(resetDb);

  it('admin creates / lists / deletes; viewer 403; past date 400', async () => {
    const { req, adminCookie, viewerCookie } = await setup();
    const body = { label: 'Grant tranche', amount: '15000000000', expectedDate: T0 + 20 * DAY };
    expect((await req('POST', '/inflows', body, viewerCookie)).statusCode).toBe(403);
    expect((await req('POST', '/inflows', { ...body, expectedDate: T0 - DAY }, adminCookie)).statusCode).toBe(400);
    const created = await req('POST', '/inflows', body, adminCookie);
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id as string;
    expect((await req('GET', '/inflows')).json().data).toEqual([{ id, label: 'Grant tranche', amount: '15000000000', expectedDate: T0 + 20 * DAY }]);
    expect((await req('DELETE', `/inflows/${id}`, undefined, viewerCookie)).statusCode).toBe(403);
    expect((await req('DELETE', `/inflows/${id}`, undefined, adminCookie)).statusCode).toBe(200);
    expect((await req('DELETE', `/inflows/${id}`, undefined, adminCookie)).statusCode).toBe(404);
  });
});

describe('POST /obligations/parse (docs/07 §5.4)', () => {
  beforeEach(resetDb);

  it('docs/12 scene 0:20 → 3 drafts stored as DRAFT (amounts as base-unit strings), audited NL_PARSE', async () => {
    const { req, adminCookie } = await setup();
    const res = await req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, adminCookie);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.drafts.map((d: { amount: string; firstDueDate: number }) => [d.amount, (d.firstDueDate - T0) / DAY])).toEqual([
      ['20000000000', 7],
      ['20000000000', 30],
      ['10000000000', 45],
    ]);
    expect(data.llm.provider).toBe('mock');
    const rows = await prisma.obligationDraft.findMany({ orderBy: { firstDueDate: 'asc' } });
    expect(rows.map((r) => [r.status, r.source, r.amount, r.sourceText === DEMO_TEXT])).toEqual([
      ['DRAFT', 'NL', '20000000000', true],
      ['DRAFT', 'NL', '20000000000', true],
      ['DRAFT', 'NL', '10000000000', true],
    ]);
    expect(rows.map((r) => r.id).sort()).toEqual(data.drafts.map((d: { draftId: string }) => d.draftId).sort());
    expect(await prisma.auditLog.count({ where: { eventType: 'NL_PARSE' } })).toBe(1);
  });

  it('admin only (401 / 403); text > 2,000 chars → 400', async () => {
    const { req, viewerCookie, adminCookie } = await setup();
    expect((await req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' })).statusCode).toBe(401);
    expect((await req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, viewerCookie)).statusCode).toBe(403);
    expect((await req('POST', '/obligations/parse', { text: 'x'.repeat(2001), locale: 'en' }, adminCookie)).statusCode).toBe(400);
  });

  it('LLM disabled → 503 LLM_UNAVAILABLE; garbage output → NL_PARSE_FAILED', async () => {
    const off = await setup({ llm: null });
    const r1 = await off.req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, off.adminCookie);
    expect(r1.statusCode).toBe(503);
    expect(r1.json().error.code).toBe('LLM_UNAVAILABLE');

    const bad = await setup({ llm: { name: 'mock', completeJson: async () => 'not json' } });
    const r2 = await bad.req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, bad.adminCookie);
    expect(r2.json().error.code).toBe('NL_PARSE_FAILED');
  });

  it('rate limit: 10 per minute per wallet → 11th is 429 RATE_LIMITED; window slides', async () => {
    let now = 1_000_000;
    const { req, adminCookie } = await setup({ nowMs: () => now });
    for (let i = 0; i < 10; i++) expect((await req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, adminCookie)).statusCode).toBe(200);
    const limited = await req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, adminCookie);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    now += 60_001;
    expect((await req('POST', '/obligations/parse', { text: DEMO_TEXT, locale: 'vi' }, adminCookie)).statusCode).toBe(200);
  });
});
