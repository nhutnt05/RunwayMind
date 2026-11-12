// docs/06 §3 — stress scenarios: the §3.5 expected-results table (SRC example, Day 0 after investing 70,000) and the
// Dataset B vectors (97 / 37 / 67 days).
import { describe, expect, it } from 'vitest';
import { formatUsdc } from '@runwaymind/shared';
import { STRESS_SCENARIO_IDS, runScenario, runStressTest, scenarioInput } from '../src/engines/stressTest';
import { DAY, T0, USDC, adapter, investedSnapshot, obligation, snapshot } from './fixtures';

const byId = (r: ReturnType<typeof runStressTest>, id: string) => {
  const s = r.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`missing scenario ${id}`);
  return s;
};

describe('stress test — SRC example table (docs/06 §3.5)', () => {
  const r = runStressTest(investedSnapshot(), []);

  it('stress_shape: baseline + exactly the 4 scenarios in fixed order; ranAt = chain time', () => {
    expect(r.scenarios.map((s) => s.id)).toEqual(['APY_DROP_50', 'POOL_LOCK_14D', 'INFLOW_DELAY_30D', 'EXPENSE_PLUS_20']);
    expect(r.baseline.id).toBe('BASELINE');
    expect(r.ranAt).toBe(T0);
    expect(r.snapshotId).toBe('snap-test');
  });

  it('stress_baseline: 365+ SAFE, yield to D45 532.60', () => {
    expect(r.baseline.runway).toMatchObject({ runwayDays: 365, capped: true, classification: 'SAFE' });
    expect(formatUsdc(r.baseline.runway.projectedYield)).toBe('532.60');
    expect(r.baseline.recommendedAction.action).toBe('NONE');
  });

  it('stress_apyDrop50: 365+ SAFE, yield to D45 266.30', () => {
    const s = byId(r, 'APY_DROP_50');
    expect(s.runway).toMatchObject({ runwayDays: 365, capped: true, classification: 'SAFE' });
    expect(formatUsdc(s.runway.projectedYield)).toBe('266.30');
    expect(s.deltaRunwayDays).toBe(0);
    expect(s.parameters).toEqual({ apyMultiplierBps: 5000 });
  });

  it('stress_poolLock14d: 365+ SAFE, min idle 10,000 (payroll fully paid during the lock)', () => {
    const s = byId(r, 'POOL_LOCK_14D');
    expect(s.runway).toMatchObject({ runwayDays: 365, capped: true, classification: 'SAFE', failure: null });
    expect(s.runway.minLiquidIdle).toBe(USDC(10_000));
    expect(s.parameters).toMatchObject({ lockDays: 14, lockStart: T0, lockEnd: T0 + 14 * DAY });
    expect(s.recommendedAction.action).toBe('NONE');
  });

  it('stress_inflowDelay30d: 365+ SAFE, "No expected inflows registered"', () => {
    const s = byId(r, 'INFLOW_DELAY_30D');
    expect(s.runway).toMatchObject({ runwayDays: 365, capped: true, classification: 'SAFE' });
    expect(s.recommendedAction).toEqual({ action: 'NONE', amount: null, note: 'No expected inflows registered' });
  });

  it('stress_expensePlus20: 365+ WATCH, shortfall now 4,000 → WITHDRAW 4,000', () => {
    const s = byId(r, 'EXPENSE_PLUS_20');
    expect(s.runway).toMatchObject({ runwayDays: 365, capped: true, classification: 'WATCH' });
    expect(s.runway.shortfallNow).toBe(USDC(4_000));
    expect(s.recommendedAction).toMatchObject({ action: 'WITHDRAW', amount: USDC(4_000) });
  });

  it('stress_worstCase: all 365+, tie broken by severity → Expenses +20% (WATCH); overall WATCH', () => {
    expect(r.worstCase).toBe('EXPENSE_PLUS_20');
    expect(r.overallClassification).toBe('WATCH');
  });
});

describe('stress test — Dataset B (docs/06 §2.4, §3.3, §3.4)', () => {
  const datasetB = () =>
    snapshot({
      idle: USDC(30_000),
      adapters: [],
      obligations: [obligation(1, USDC(20_000), T0 + 7 * DAY, { interval: 30 * DAY, maxOccurrences: 0 })],
      onchainRequiredReserve: USDC(30_000),
    });
  const inflows = [{ id: 'in-1', label: 'Grant tranche', amount: USDC(30_000), expectedDate: T0 + 25 * DAY }];
  const r = runStressTest(datasetB(), inflows, { includeYield: false });

  it('stress_datasetB_baseline: failure at D97 → runway 97 days', () => {
    expect(r.baseline.runway.runwayDays).toBe(97);
    expect(r.baseline.runway.failure).toEqual({ at: T0 + 97 * DAY, kind: 'SOLVENCY', obligationId: 1n, missing: USDC(20_000) });
  });

  it('stress_datasetB_inflowDelay: inflow D25 → D55, failure at D37 → runway 37, WATCH, HOLD 10,000', () => {
    const s = byId(r, 'INFLOW_DELAY_30D');
    expect(s.runway.runwayDays).toBe(37);
    expect(s.runway.classification).toBe('WATCH');
    expect(s.runway.failure).toMatchObject({ at: T0 + 37 * DAY, obligationId: 1n, missing: USDC(10_000) });
    expect(s.deltaRunwayDays).toBe(37 - 97);
    expect(s.recommendedAction).toMatchObject({ action: 'HOLD', amount: USDC(10_000) });
    expect(s.recommendedAction.note).toContain('day 37');
  });

  it('stress_datasetB_expensePlus20: payroll 24,000, failure at D67 → runway 67', () => {
    const s = byId(r, 'EXPENSE_PLUS_20');
    expect(s.runway.runwayDays).toBe(67);
    expect(s.runway.failure).toMatchObject({ at: T0 + 67 * DAY, obligationId: 1n, missing: USDC(12_000) });
    expect(s.deltaRunwayDays).toBe(67 - 97);
  });

  // Docs conflict (rule 10, open question): §2.2 normative rules give different classes than the prose.
  // - §2.4 says baseline SAFE (> 90), but idle + vault drops below the 10,000 buffer at D67 → §2.2 "bufferBreachAt
  //   within 90 days" → WATCH.
  // - §3.4 says EXPENSE_PLUS_20 WATCH, but scenario reserve at D0 = 24,000 + 10,000 = 34,000 > idle 30,000 with no vault
  //   → shortfallNow 4,000 not withdrawable → §2.2 CRITICAL.
  it.todo('stress_datasetB_classification: baseline SAFE and EXPENSE_PLUS_20 WATCH per docs/06 §2.4/§3.4 (conflicts with §2.2)');

  it('stress_datasetB_unaffected: no vault → APY drop and pool lock equal the baseline (97)', () => {
    expect(byId(r, 'APY_DROP_50').runway.runwayDays).toBe(97);
    expect(byId(r, 'POOL_LOCK_14D').runway.runwayDays).toBe(97);
  });

  it('stress_datasetB_worstCase: inflow delay (37 days)', () => {
    expect(r.worstCase).toBe('INFLOW_DELAY_30D');
  });
});

describe('stress test — options and edge cases', () => {
  it('stress_subset: only the requested scenarios, fixed order kept', () => {
    const r = runStressTest(investedSnapshot(), [], { scenarios: ['EXPENSE_PLUS_20', 'APY_DROP_50'] });
    expect(r.scenarios.map((s) => s.id)).toEqual(['APY_DROP_50', 'EXPENSE_PLUS_20']);
    expect(r.worstCase).toBe('EXPENSE_PLUS_20');
  });

  it('stress_apyBelowMinimum: −50% APY under minApyBps → WATCH with hypothetical APY_BELOW_MINIMUM note', () => {
    const s = runScenario('APY_DROP_50', investedSnapshot({ adapters: [adapter(USDC(70_000), { apyBps: 500 })] }), [], { minApyBps: 300 });
    expect(s.runway.classification).toBe('WATCH');
    expect(s.recommendedAction.action).toBe('NONE');
    expect(s.recommendedAction.note).toContain('APY_BELOW_MINIMUM');
  });

  it('stress_lockCritical: lock with too little idle → CRITICAL, WITHDRAW the missing amount', () => {
    const s = runScenario('POOL_LOCK_14D', investedSnapshot({ idle: USDC(10_000) }), []);
    expect(s.runway.classification).toBe('CRITICAL');
    expect(s.runway.failure).toMatchObject({ kind: 'LIQUIDITY', at: T0 + 7 * DAY });
    expect(s.recommendedAction).toMatchObject({ action: 'WITHDRAW', amount: USDC(10_000) });
  });

  it('stress_scenarioInput: modifiers per docs/06 §3.1–§3.4', () => {
    const s = investedSnapshot();
    expect(scenarioInput('APY_DROP_50', s, []).apyMultiplierBps).toBe(5000);
    expect(scenarioInput('POOL_LOCK_14D', s, []).lock).toEqual({ start: T0, end: T0 + 14 * DAY });
    expect(scenarioInput('INFLOW_DELAY_30D', s, []).inflowDelaySec).toBe(30 * DAY);
    expect(scenarioInput('EXPENSE_PLUS_20', s, []).expenseMultiplierBps).toBe(12_000);
    expect(STRESS_SCENARIO_IDS).toHaveLength(4);
  });
});
