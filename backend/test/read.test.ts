import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { derivedState } from '../src/services/treasury';
import { ADAPTER, DAY, FakeChain, T0, TREASURY, makeApp, prisma, resetDb } from './helpers';

/** docs/07 §2.2 / docs/10 §5: amounts must never be serialized as JSON numbers. */
function assertNoAmountNumbers(value: unknown, path = '$'): void {
  const AMOUNT_KEY = /amount|idle|balance|total|reserve|shortfall|investable|yield|liquidity|tvl|buffer|deficit|projected|payments|withdrawals/i;
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoAmountNumbers(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'number' && AMOUNT_KEY.test(k) && !/bps|days|count|index/i.test(k)) {
        throw new Error(`${path}.${k} is a JSON number`);
      }
      assertNoAmountNumbers(v, `${path}.${k}`);
    }
  }
}

describe('read endpoints (docs/07 §3–§4.3)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('GET /health', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      error: null,
      data: { status: 'ok', chainId: 43113, blockNumber: '123' },
      meta: { blockNumber: '123' },
    });
    expect(res.json().meta.requestId).toEqual(expect.any(String));
  });

  it('GET /treasury/overview — SRC Day 0 figures, amounts as strings', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/treasury/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ chainTime: T0, blockNumber: '123' });
    expect(body.data).toMatchObject({
      treasury: TREASURY,
      chainTime: T0,
      demoMode: true,
      demoStartTime: T0,
      idle: '100000000000',
      vaultTotal: '0',
      totalAssets: '100000000000',
      requiredReserve: '30000000000',
      shortfall: '0',
      investableCapital: '70000000000',
      capitalEfficiencyBps: 7000,
      actualEfficiencyBps: 0,
      accruedYield: null,
      runway: { runwayDays: 365, capped: true, classification: 'SAFE' },
      policy: { safetyHorizonSec: 14 * DAY, emergencyBuffer: '10000000000', maxExposureBps: 7000 },
      nextObligation: { id: '1', label: 'November payroll', amount: '20000000000', dueDate: T0 + 7 * DAY },
      pendingRecommendations: 0,
    });
    expect(body.data.adapters[0]).toMatchObject({ address: ADAPTER, status: 'ACTIVE', riskScore: 87 }); // docs/06 §4.3 D0 (util 50%, cash 10,000)
    assertNoAmountNumbers(body.data);
  });

  it('GET /treasury/overview — 502 CHAIN_UNAVAILABLE when RPC is down', async () => {
    const chain = new FakeChain();
    chain.down = true;
    const { app } = await makeApp(chain);
    const res = await app.inject({ method: 'GET', url: '/api/v1/treasury/overview' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ success: false, data: null, error: { code: 'CHAIN_UNAVAILABLE' } });
  });

  it('GET /obligations — joins metadata, filters by status, derives state', async () => {
    const { app } = await makeApp();
    const all = await app.inject({ method: 'GET', url: '/api/v1/obligations?status=ALL' });
    expect(all.statusCode).toBe(200);
    expect(all.json().data).toHaveLength(4);
    const active = (await app.inject({ method: 'GET', url: '/api/v1/obligations?status=ACTIVE' })).json().data;
    expect(active).toHaveLength(3);
    expect(active[0]).toMatchObject({
      id: '1',
      amount: '20000000000',
      nextDueDate: T0 + 7 * DAY,
      withdrawalDeadline: T0 - 7 * DAY,
      derivedState: 'IN_WINDOW',
      metadata: { label: 'November payroll', notes: null, source: 'SEED' },
    });
    expect(active[1]).toMatchObject({ id: '2', derivedState: 'SCHEDULED', withdrawalDeadline: T0 + 16 * DAY, metadata: null });
    const cancelled = (await app.inject({ method: 'GET', url: '/api/v1/obligations?status=CANCELLED' })).json().data;
    expect(cancelled).toEqual([expect.objectContaining({ id: '4', derivedState: 'CANCELLED' })]);
  });

  it('GET /obligations — 400 VALIDATION_ERROR for an unknown status', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/obligations?status=PAID' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('GET /obligations/:id — detail with next occurrences and indexed payments', async () => {
    await prisma.indexedEvent.create({
      data: {
        id: '0xabc:0',
        treasuryId: 'local-musdc',
        name: 'ObligationPaid',
        blockNumber: '99',
        txHash: '0xabc',
        args: JSON.stringify({ id: '2', recipient: '0x2', amount: '1', occurrence: '1' }),
      },
    });
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/obligations/2' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ id: '2', derivedState: 'SCHEDULED' });
    expect(data.occurrences).toHaveLength(1);
    expect(data.occurrences[0]).toMatchObject({ dueDate: T0 + 30 * DAY, withdrawalDeadline: T0 + 16 * DAY });
    expect(data.payments).toEqual([expect.objectContaining({ txHash: '0xabc', occurrence: 1 })]);
  });

  it('GET /obligations/:id — 404 for unknown id, 400 for a non-numeric id', async () => {
    const { app } = await makeApp();
    const missing = await app.inject({ method: 'GET', url: '/api/v1/obligations/99' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
    const bad = await app.inject({ method: 'GET', url: '/api/v1/obligations/abc' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /cash-ladder — CashLadderResult with bigint → string', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/cash-ladder?projectionDays=30&includeYield=false' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ requiredReserve: '30000000000', investableCapital: '70000000000', capitalEfficiencyBps: 7000 });
    expect(data.daily).toHaveLength(31);
    expect(data.investableNow).toEqual([{ adapter: ADAPTER, amount: '70000000000' }]);
    assertNoAmountNumbers(data);
  });

  it('GET /cash-ladder — 400 for projectionDays outside 1–365', async () => {
    const { app } = await makeApp();
    for (const q of ['projectionDays=0', 'projectionDays=366', 'includeYield=maybe']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/cash-ladder?${q}` });
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('GET /cash-ladder/withdrawal-schedule — D16 20,000 and D31 10,000 after investing', async () => {
    const chain = new FakeChain();
    chain.snapshot = {
      ...chain.snapshot,
      idle: 30_000_000_000n,
      adapters: [{ ...chain.snapshot.adapters[0]!, balance: 70_000_000_000n, availableLiquidity: 80_000_000_000n }],
    };
    const { app } = await makeApp(chain);
    const res = await app.inject({ method: 'GET', url: '/api/v1/cash-ladder/withdrawal-schedule' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items.map((i: { deadline: number; amount: string }) => [i.deadline - T0, i.amount])).toEqual([
      [16 * DAY, '20000000000'],
      [31 * DAY, '10000000000'],
    ]);
  });

  it('unknown route → envelope 404', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('Swagger UI is served at /api/v1/docs', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toEqual(expect.arrayContaining(['/treasury/overview', '/cash-ladder', '/obligations/{id}']));
  });
});

describe('derivedState (docs/07 §4.2)', () => {
  const base = { status: 'ACTIVE' as const, nextDueDate: T0 + 10 * DAY };
  const H = 14 * DAY;
  it('covers every state', () => {
    expect(derivedState({ ...base, status: 'CANCELLED' } as never, T0, H)).toBe('CANCELLED');
    expect(derivedState({ ...base, status: 'COMPLETED' } as never, T0, H)).toBe('PAID');
    expect(derivedState(base as never, T0 + 10 * DAY, H)).toBe('DUE');
    expect(derivedState(base as never, T0 + 11 * DAY, H)).toBe('OVERDUE');
    expect(derivedState(base as never, T0, H)).toBe('IN_WINDOW');
    expect(derivedState({ ...base, nextDueDate: T0 + 30 * DAY } as never, T0, H)).toBe('SCHEDULED');
  });
});
