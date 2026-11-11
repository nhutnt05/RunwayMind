import { describe, expect, it } from 'vitest';
import { formatUsdc } from '@runwaymind/shared';
import { baselineRunwayInput, classify, computeRunway } from '../src/engines/runway';
import { DAY, T0, USDC, investedSnapshot, obligation, snapshot } from './fixtures';

describe('runway baseline — SRC example (docs/06 §2.4)', () => {
  it('365+ days, capped, SAFE; yield to D45 = 532.60 (simple accrual)', () => {
    const r = computeRunway(baselineRunwayInput(investedSnapshot()));
    expect(r.runwayDays).toBe(365);
    expect(r.capped).toBe(true);
    expect(r.failure).toBeNull();
    expect(r.classification).toBe('SAFE');
    expect(r.shortfallNow).toBe(0n);
    expect(r.bufferBreachAt).toBeNull();
    expect(r.minLiquidIdle).toBe(USDC(10_000));
    // 70,000×0.08×16/365 + 50,000×0.08×15/365 + 40,000×0.08×14/365 = 532.602739…
    expect(r.projectedYield).toBe(532_602_738n); // floor per accrual segment (event at D7)
    expect(formatUsdc(r.projectedYield)).toBe("532.60");
  });

  it('APY −50% halves the yield (scenario modifier)', () => {
    const r = computeRunway({ ...baselineRunwayInput(investedSnapshot()), apyMultiplierBps: 5000 });
    expect(formatUsdc(r.projectedYield)).toBe("266.30");
    expect(r.runwayDays).toBe(365);
  });
});

describe('runway baseline — Dataset B (docs/06 §2.4)', () => {
  const datasetB = () =>
    snapshot({
      idle: USDC(30_000),
      adapters: [],
      obligations: [obligation(1, USDC(20_000), T0 + 7 * DAY, { interval: 30 * DAY, maxOccurrences: 0 })],
      onchainRequiredReserve: USDC(30_000),
    });
  const inflow = [{ id: 'in-1', label: 'Grant tranche', amount: USDC(30_000), expectedDate: T0 + 25 * DAY }];

  it('fails at D97: runway 97 days, solvency failure missing 20,000', () => {
    const r = computeRunway({ ...baselineRunwayInput(datasetB(), inflow), includeYield: false });
    expect(r.runwayDays).toBe(97);
    expect(r.capped).toBe(false);
    expect(r.failure).toEqual({ at: T0 + 97 * DAY, kind: 'SOLVENCY', obligationId: 1n, missing: USDC(20_000) });
  });

  it('inflow delayed 30 days → runway 37 (scenario 3 vector)', () => {
    const r = computeRunway({ ...baselineRunwayInput(datasetB(), inflow), includeYield: false, inflowDelaySec: 30 * DAY });
    expect(r.runwayDays).toBe(37);
    expect(r.failure?.missing).toBe(USDC(10_000));
  });

  it('expenses +20% → runway 67 (scenario 4 vector)', () => {
    const r = computeRunway({ ...baselineRunwayInput(datasetB(), inflow), includeYield: false, expenseMultiplierBps: 12_000 });
    expect(r.runwayDays).toBe(67);
  });
});

describe('runway — lock and shortfall', () => {
  it('a 14-day lock from now cannot cause a missed payment (SRC, docs/06 §3.2)', () => {
    const s = investedSnapshot();
    const r = computeRunway({ ...baselineRunwayInput(s), lock: { start: T0, end: T0 + 14 * DAY } });
    expect(r.failure).toBeNull();
    expect(r.minLiquidIdle).toBe(USDC(10_000));
    expect(r.classification).toBe('SAFE');
  });

  it('expenses +20% on SRC → shortfallNow 4,000 (withdrawable) → WATCH', () => {
    const r = computeRunway({ ...baselineRunwayInput(investedSnapshot()), expenseMultiplierBps: 12_000 });
    expect(r.shortfallNow).toBe(USDC(4_000));
    expect(r.runwayDays).toBe(365);
    expect(r.classification).toBe('WATCH');
  });

  it('liquidity failure when the vault is locked at a payment', () => {
    const s = investedSnapshot({ idle: USDC(10_000), onchainRequiredReserve: USDC(30_000) });
    const r = computeRunway({ ...baselineRunwayInput(s), lock: { start: T0, end: T0 + 20 * DAY } });
    expect(r.failure).toMatchObject({ at: T0 + 7 * DAY, kind: 'LIQUIDITY', obligationId: 1n, missing: USDC(10_000) });
    expect(r.runwayDays).toBe(7);
    expect(r.classification).toBe('CRITICAL');
  });
});

describe('classify (docs/06 §2.2)', () => {
  it('boundaries at 30 / 90 days', () => {
    expect(classify(30, true, null, T0, 0n, 0n)).toBe('CRITICAL');
    expect(classify(31, true, null, T0, 0n, 0n)).toBe('WATCH');
    expect(classify(90, true, null, T0, 0n, 0n)).toBe('WATCH');
    expect(classify(91, true, null, T0, 0n, 0n)).toBe('SAFE');
    expect(classify(365, false, null, T0, 0n, 0n)).toBe('SAFE');
  });

  it('shortfall now: withdrawable → WATCH, not withdrawable → CRITICAL', () => {
    expect(classify(365, false, null, T0, 1n, 1n)).toBe('WATCH');
    expect(classify(365, false, null, T0, 2n, 1n)).toBe('CRITICAL');
  });

  it('buffer breach within 90 days → WATCH', () => {
    expect(classify(365, false, T0 + 90 * DAY, T0, 0n, 0n)).toBe('WATCH');
    expect(classify(365, false, T0 + 91 * DAY, T0, 0n, 0n)).toBe('SAFE');
  });
});
