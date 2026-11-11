import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ObligationOnChain } from '@runwaymind/shared';
import {
  allocateSources,
  computeCashLadder,
  expandOccurrences,
  requiredReserveAt,
  withdrawalDeadline,
} from '../src/engines/cashLadder';
import { ADAPTER, ADAPTER2, DAY, T0, USDC, adapter, investedSnapshot, obligation, snapshot } from './fixtures';

describe('Cash Ladder — SRC vector (docs/04 §5)', () => {
  it('Day 0: required 30,000; investable 70,000; efficiency 7000 bps', () => {
    const r = computeCashLadder(snapshot());
    expect(r.requiredReserve).toBe(30_000_000_000n);
    expect(r.investableCapital).toBe(70_000_000_000n);
    expect(r.capitalEfficiencyBps).toBe(7000);
    expect(r.investableNow).toEqual([{ adapter: ADAPTER, amount: 70_000_000_000n }]);
    expect(r.totalAssets).toBe(100_000_000_000n);
    expect(r.shortfall).toBe(0n);
    expect(r.warnings).toEqual([]);
  });

  it('deadlines: O1 = Day −7 (already in window), O2 = Day 16, O3 = Day 31', () => {
    const r = computeCashLadder(snapshot());
    const byId = Object.fromEntries(r.occurrences.map((o) => [o.obligationId.toString(), o]));
    expect(byId['1']!.withdrawalDeadline).toBe(T0 - 7 * DAY);
    expect(byId['1']!.state).toBe('IN_WINDOW');
    expect(byId['2']!.withdrawalDeadline).toBe(T0 + 16 * DAY);
    expect(byId['3']!.withdrawalDeadline).toBe(T0 + 31 * DAY);
    expect(byId['2']!.state).toBe('SCHEDULED');
  });

  it('withdrawal schedule after investing 70,000: exactly D16 (20,000) and D31 (10,000)', () => {
    const r = computeCashLadder(investedSnapshot());
    expect(r.withdrawalSchedule).toEqual([
      {
        deadline: T0 + 16 * DAY,
        amount: 20_000_000_000n,
        requiredReserveAfter: 30_000_000_000n,
        covers: [{ obligationId: 2n, occurrenceIndex: 1, dueDate: T0 + 30 * DAY, amount: 20_000_000_000n }],
        suggestedSources: [{ adapter: ADAPTER, amount: 20_000_000_000n }],
        state: 'UPCOMING',
      },
      {
        deadline: T0 + 31 * DAY,
        amount: 10_000_000_000n,
        requiredReserveAfter: 20_000_000_000n,
        covers: [{ obligationId: 3n, occurrenceIndex: 1, dueDate: T0 + 45 * DAY, amount: 10_000_000_000n }],
        suggestedSources: [{ adapter: ADAPTER, amount: 10_000_000_000n }],
        state: 'UPCOMING',
      },
    ]);
    expect(r.actualEfficiencyBps).toBe(7000);
    expect(r.warnings).toEqual([]);
  });

  it('daily projection follows the event table (no yield)', () => {
    const r = computeCashLadder(investedSnapshot(), { includeProjectedYield: false, projectionDays: 45 });
    const day = (d: number) => r.daily[d]!;
    expect(r.daily).toHaveLength(46);
    expect(day(0)).toMatchObject({ projectedIdle: USDC(30_000), projectedVault: USDC(70_000), requiredReserve: USDC(30_000) });
    expect(day(7)).toMatchObject({ paymentsToday: USDC(20_000), projectedIdle: USDC(10_000), requiredReserve: USDC(10_000) });
    expect(day(16)).toMatchObject({ withdrawalsToday: USDC(20_000), projectedIdle: USDC(30_000), projectedVault: USDC(50_000) });
    expect(day(30)).toMatchObject({ paymentsToday: USDC(20_000), projectedIdle: USDC(10_000) });
    expect(day(31)).toMatchObject({ withdrawalsToday: USDC(10_000), projectedIdle: USDC(20_000), projectedVault: USDC(40_000) });
    expect(day(45)).toMatchObject({ paymentsToday: USDC(10_000), projectedIdle: USDC(10_000), projectedVault: USDC(40_000) });
    expect(r.daily.every((p) => p.deficit === 0n && p.projectedYieldCumulative === 0n)).toBe(true);
  });

  it('daily projection with yield accrues but never changes the schedule', () => {
    const withYield = computeCashLadder(investedSnapshot(), { includeProjectedYield: true, projectionDays: 45 });
    const noYield = computeCashLadder(investedSnapshot(), { includeProjectedYield: false, projectionDays: 45 });
    expect(withYield.withdrawalSchedule).toEqual(noYield.withdrawalSchedule);
    const last = withYield.daily.at(-1)!;
    // docs/06 §2.4 quotes 532.60 USDC for *simple* accrual on principal only. The ladder accrues with the pool
    // formula (compounded at each daily accrual point) and earned interest stays invested after withdrawals,
    // so the projection is slightly higher (535.51), never lower.
    expect(last.projectedYieldCumulative).toBeGreaterThan(USDC(532));
    expect(last.projectedYieldCumulative).toBeLessThan(USDC(537));
  });
});

describe('Cash Ladder — edge cases (docs/10 §4.1)', () => {
  it('same-day obligations are merged into one schedule item', () => {
    const r = computeCashLadder(
      investedSnapshot({
        obligations: [
          obligation(1, USDC(5_000), T0 + 30 * DAY),
          obligation(2, USDC(7_000), T0 + 30 * DAY),
        ],
        onchainRequiredReserve: USDC(10_000),
        idle: USDC(10_000),
      }),
    );
    expect(r.withdrawalSchedule).toHaveLength(1);
    expect(r.withdrawalSchedule[0]!.amount).toBe(USDC(12_000));
    expect(r.withdrawalSchedule[0]!.covers.map((c) => c.obligationId)).toEqual([1n, 2n]);
  });

  it('recurring interval 7 d with H 14: 2 occurrences in window', () => {
    const ob = obligation(1, USDC(1_000), T0 + 3 * DAY, { interval: 7 * DAY, maxOccurrences: 0 });
    const r = computeCashLadder(snapshot({ obligations: [ob], onchainRequiredReserve: USDC(12_000) }));
    const inWindow = r.occurrences.filter((o) => o.state === 'IN_WINDOW');
    expect(inWindow.map((o) => o.dueDate)).toEqual([T0 + 3 * DAY, T0 + 10 * DAY]);
    expect(r.requiredReserve).toBe(USDC(12_000)); // 2 × 1,000 + buffer
  });

  it('overdue occurrence is included and warned; DUE_NOW item asks for it', () => {
    const r = computeCashLadder(
      snapshot({
        chainTime: T0 + 10 * DAY,
        idle: USDC(5_000),
        adapters: [adapter(USDC(95_000))],
        obligations: [obligation(1, USDC(20_000), T0 + 7 * DAY)],
      }),
    );
    expect(r.requiredReserve).toBe(USDC(30_000));
    expect(r.occurrences[0]!.state).toBe('OVERDUE');
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['OVERDUE_OBLIGATION', 'SHORTFALL_NOW']));
    expect(r.shortfall).toBe(USDC(25_000));
    expect(r.withdrawalSchedule[0]).toMatchObject({ deadline: T0 + 10 * DAY, amount: USDC(25_000), state: 'DUE_NOW' });
    expect(r.withdrawalSchedule[0]!.covers).toHaveLength(1);
  });

  it('underfunded (total 20k, required 30k): investable 0; UNDERFUNDED 10,000', () => {
    const r = computeCashLadder(snapshot({ idle: USDC(20_000) }));
    expect(r.investableCapital).toBe(0n);
    expect(r.investableNow.every((x) => x.amount === 0n)).toBe(true);
    const w = r.warnings.find((x) => x.code === 'UNDERFUNDED');
    expect(w?.amount).toBe(USDC(10_000));
  });

  it('breaker active: investableNow all 0; schedule unaffected', () => {
    const r = computeCashLadder(investedSnapshot({ circuitBreakerActive: true }));
    expect(r.investableNow.every((x) => x.amount === 0n)).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('CIRCUIT_BREAKER_ACTIVE');
    expect(r.withdrawalSchedule).toHaveLength(2);
  });

  it('illiquid pool: LIQUIDITY_RISK warning, partial sources', () => {
    const r = computeCashLadder(investedSnapshot({ adapters: [adapter(USDC(70_000), { availableLiquidity: USDC(5_000) })] }));
    const item = r.withdrawalSchedule[0]!;
    expect(item.amount).toBe(USDC(20_000));
    expect(item.suggestedSources).toEqual([{ adapter: ADAPTER, amount: USDC(5_000) }]);
    const w = r.warnings.find((x) => x.code === 'LIQUIDITY_RISK');
    expect(w?.amount).toBe(USDC(15_000));
  });

  it('on-chain mismatch is reported', () => {
    const r = computeCashLadder(snapshot({ onchainRequiredReserve: USDC(29_999) }));
    expect(r.warnings.find((w) => w.code === 'ONCHAIN_MISMATCH')?.amount).toBe(USDC(1));
  });

  it('future insolvency carries the first failing time', () => {
    const r = computeCashLadder(investedSnapshot({ adapters: [adapter(USDC(10_000))] })); // total 40k < 60k needs
    const w = r.warnings.find((x) => x.code === 'FUTURE_INSOLVENCY');
    expect(w).toBeDefined();
    expect(w!.at).toBe(T0 + 16 * DAY);
  });

  it('no obligations: required = buffer, schedule empty; total 0 has no division', () => {
    const r = computeCashLadder(snapshot({ obligations: [], onchainRequiredReserve: USDC(10_000) }));
    expect(r.requiredReserve).toBe(USDC(10_000));
    expect(r.withdrawalSchedule).toEqual([]);
    const empty = computeCashLadder(snapshot({ idle: 0n, obligations: [], onchainRequiredReserve: USDC(10_000) }));
    expect(empty.capitalEfficiencyBps).toBe(0);
    expect(empty.actualEfficiencyBps).toBe(0);
  });

  it('cancelled / completed obligations are ignored', () => {
    const r = computeCashLadder(
      snapshot({ obligations: [obligation(1, USDC(20_000), T0 + DAY, { status: 'CANCELLED' })], onchainRequiredReserve: USDC(10_000) }),
    );
    expect(r.occurrences).toEqual([]);
  });

  it('rejects projectionDays outside [0, 365]', () => {
    expect(() => computeCashLadder(snapshot(), { projectionDays: 366 })).toThrow(RangeError);
  });

  it('runs in < 50 ms for 50 obligations × 60 days', () => {
    const obligations = Array.from({ length: 50 }, (_, i) =>
      obligation(i + 1, USDC(100), T0 + (i + 1) * DAY, { interval: 1 * DAY, maxOccurrences: 0 }),
    );
    const s = investedSnapshot({ obligations });
    computeCashLadder(s); // warm up
    const start = performance.now();
    computeCashLadder(s, { projectionDays: 60 });
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('deadline calculation (docs/10 §4.2)', () => {
  it.each([1, 14, 90])('withdrawalDeadline = due − H for H = %i days', (h) => {
    expect(withdrawalDeadline(T0 + 100 * DAY, h * DAY)).toBe(T0 + (100 - h) * DAY);
  });

  it('saturates at 0', () => {
    expect(withdrawalDeadline(10, 14 * DAY)).toBe(0);
  });

  it('boundary inclusive: due == now + H counts', () => {
    const occ = expandOccurrences([obligation(1, USDC(1), T0 + 14 * DAY)], T0, T0 + 100 * DAY, 1000, 14 * DAY);
    expect(requiredReserveAt(occ, T0, 14 * DAY, 0n)).toBe(USDC(1));
    expect(requiredReserveAt(occ, T0 - 1, 14 * DAY, 0n)).toBe(0n);
    expect(occ[0]!.state).toBe('IN_WINDOW');
  });

  it('changing H shifts the schedule', () => {
    const h14 = computeCashLadder(investedSnapshot());
    const h21 = computeCashLadder(
      investedSnapshot({ policy: { safetyHorizonSec: 21 * DAY, emergencyBuffer: USDC(10_000), maxExposureBps: 7000 } }),
    );
    expect(h14.withdrawalSchedule[0]!.deadline).toBe(T0 + 16 * DAY);
    expect(h21.withdrawalSchedule[0]!.deadline).toBe(T0 + 9 * DAY);
  });
});

describe('expandOccurrences', () => {
  it('respects maxOccurrences − paidOccurrences and the cap', () => {
    const ob = obligation(1, USDC(1), T0 + DAY, { interval: DAY, maxOccurrences: 5, paidOccurrences: 2 });
    const out = expandOccurrences([ob], T0, T0 + 365 * DAY, 1000, 14 * DAY);
    expect(out.map((o) => o.occurrenceIndex)).toEqual([3, 4, 5]);
    const unlimited = obligation(2, USDC(1), T0 + DAY, { interval: DAY, maxOccurrences: 0 });
    expect(expandOccurrences([unlimited], T0, T0 + 365 * DAY, 10, 14 * DAY)).toHaveLength(10);
  });

  it('sorts by (dueDate, obligationId, occurrenceIndex)', () => {
    const out = expandOccurrences(
      [obligation(2, USDC(1), T0 + DAY), obligation(1, USDC(1), T0 + DAY), obligation(3, USDC(1), T0)],
      T0,
      T0 + 10 * DAY,
      1000,
      14 * DAY,
    );
    expect(out.map((o) => o.obligationId)).toEqual([3n, 1n, 2n]);
  });
});

describe('allocateSources', () => {
  it('prefers WITHDRAW_ONLY, then highest score, then highest liquidity', () => {
    const a = adapter(USDC(50), { address: ADAPTER, availableLiquidity: USDC(100) });
    const b = adapter(USDC(50), { address: ADAPTER2, availableLiquidity: USDC(10), status: 'WITHDRAW_ONLY' });
    expect(allocateSources(USDC(60), [a, b]).sources).toEqual([
      { adapter: ADAPTER2, amount: USDC(10) },
      { adapter: ADAPTER, amount: USDC(50) },
    ]);
    const c = adapter(USDC(50), { address: ADAPTER2, availableLiquidity: USDC(100) });
    expect(allocateSources(USDC(10), [a, c], { [ADAPTER]: 20, [ADAPTER2]: 90 }).sources[0]!.adapter).toBe(ADAPTER2);
  });

  it('reports unallocated amount and skips NONE adapters', () => {
    const r = allocateSources(USDC(100), [adapter(USDC(30), { availableLiquidity: USDC(30) }), adapter(USDC(999), { status: 'NONE' })]);
    expect(r.allocated).toBe(USDC(30));
    expect(r.unallocated).toBe(USDC(70));
  });
});

describe('property: schedule never leaves an occurrence unpaid when vault is liquid (docs/04 §7)', () => {
  it('holds for random obligation sets', () => {
    const obArb = fc.record({
      amount: fc.bigInt({ min: 1n, max: USDC(20_000) }),
      dueDay: fc.integer({ min: 1, max: 90 }),
      interval: fc.constantFrom(0, 7, 30),
      max: fc.integer({ min: 2, max: 6 }),
    });
    fc.assert(
      fc.property(fc.array(obArb, { minLength: 0, maxLength: 12 }), fc.bigInt({ min: 0n, max: USDC(500_000) }), (raw, extra) => {
        const obligations: ObligationOnChain[] = raw.map((o, i) =>
          obligation(i + 1, o.amount, T0 + o.dueDay * DAY, {
            interval: o.interval * DAY,
            maxOccurrences: o.interval === 0 ? 1 : o.max,
          }),
        );
        // Enough total assets for every occurrence in the horizon + buffer; vault fully liquid.
        const s0 = snapshot({ obligations, idle: 0n, adapters: [] });
        const occ = computeCashLadder({ ...s0, onchainRequiredReserve: 0n }).occurrences;
        const need = occ.reduce((sum, o) => sum + o.amount, USDC(10_000));
        const s = snapshot({
          obligations,
          idle: USDC(10_000),
          adapters: [adapter(need + extra, { availableLiquidity: need + extra })],
        });
        const r = computeCashLadder({ ...s, onchainRequiredReserve: computeCashLadder(s).requiredReserve }, { includeProjectedYield: false });
        expect(r.warnings.some((w) => w.code === 'FUTURE_INSOLVENCY' || w.code === 'LIQUIDITY_RISK')).toBe(false);
        // Each day's idle covers every payment due that day: idle never negative and keeper never pulls.
        for (const p of r.daily) expect(p.projectedIdle >= 0n).toBe(true);
        for (const item of r.withdrawalSchedule) {
          const sourced = item.suggestedSources.reduce((sum, x) => sum + x.amount, 0n);
          expect(sourced).toBe(item.amount);
        }
      }),
      { numRuns: 200 },
    );
  });
});
