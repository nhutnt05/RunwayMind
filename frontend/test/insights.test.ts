import { describe, expect, it } from 'vitest';
import { CreateObligationRequestSchema } from '@runwaymind/shared';
import {
  draftDueDate,
  draftToCreateRequest,
  runwayFraction,
  runwayLabel,
  scenarioKeyNumber,
  tickAccruedYield,
  weightedApyBps,
  worstCaseLine,
  type DraftJson,
  type ScenarioJson,
} from '../lib/insights';

const USDC = (n: number) => BigInt(n) * 1_000_000n;

describe('runway meter helpers', () => {
  it('labels, gauge fraction and worst-case line (docs/06 §2.3)', () => {
    expect(runwayLabel({ runwayDays: 365, capped: true })).toBe('365+ days');
    expect(runwayLabel({ runwayDays: 97, capped: false })).toBe('97 days');
    expect(runwayFraction(97)).toBeCloseTo(97 / 365);
    expect(runwayFraction(900)).toBe(1);
    expect(worstCaseLine({ id: 'INFLOW_DELAY_30D', runwayDays: 37 })).toBe('Worst case: 37 days — Inflows delayed 30 days');
    expect(worstCaseLine(null)).toBeNull();
  });
});

describe('accrued yield ticker', () => {
  it('70,000 at 8% for 2 days → +30.68 (docs/12 §3)', () => {
    expect(tickAccruedYield(0n, USDC(70_000), 800, 2 * 86_400)).toBe(30_684_931n);
  });
  it('no movement without vault, APY or elapsed time', () => {
    expect(tickAccruedYield(5n, 0n, 800, 100)).toBe(5n);
    expect(tickAccruedYield(5n, USDC(1), 0, 100)).toBe(5n);
    expect(tickAccruedYield(5n, USDC(1), 800, 0)).toBe(5n);
  });
  it('weighted APY across adapters', () => {
    expect(weightedApyBps([{ balance: '70000000000', apyBps: 800 }, { balance: '30000000000', apyBps: 400 }])).toBe(680);
    expect(weightedApyBps([])).toBe(0);
  });
});

describe('scenario key number', () => {
  const base: ScenarioJson = {
    id: 'APY_DROP_50',
    label: 'APY −50%',
    parameters: {},
    runway: { runwayDays: 365, capped: true, classification: 'SAFE', shortfallNow: '0', minLiquidIdle: '10000000000', projectedYield: '266300000', failure: null },
    deltaRunwayDays: 0,
    recommendedAction: { action: 'NONE', amount: null, note: '' },
  };
  it('picks failure > shortfall > min idle (pool lock) > yield', () => {
    expect(scenarioKeyNumber(base)).toBe('Projected yield 266.30 USDC');
    expect(scenarioKeyNumber({ ...base, id: 'POOL_LOCK_14D' })).toBe('Min idle 10,000.00 USDC');
    expect(scenarioKeyNumber({ ...base, runway: { ...base.runway, shortfallNow: '4000000000' } })).toBe('Shortfall now 4,000.00 USDC');
    expect(scenarioKeyNumber({ ...base, runway: { ...base.runway, failure: { at: 1, kind: 'SOLVENCY', obligationId: '1', missing: '20000000000' } } })).toBe(
      'Fails: missing 20,000.00 USDC',
    );
  });
});

describe('NL draft → POST /obligations body', () => {
  const draft: DraftJson = {
    draftId: 'drf_1',
    label: 'November payroll',
    category: 'PAYROLL',
    recipient: '0x0000000000000000000000000000000000000001',
    amount: '20000000000',
    firstDueDate: 1_793_923_200,
    interval: 0,
    maxOccurrences: 1,
    warnings: [],
    sourceSpan: 'lương 20k',
  };
  it('valid against the shared schema, linked by nlDraftId, amount stays base units', () => {
    const body = draftToCreateRequest(draft);
    expect(body).toMatchObject({ source: 'NL', nlDraftId: 'drf_1', amount: '20000000000' });
    expect(CreateObligationRequestSchema.safeParse(body).success).toBe(true);
  });
  it('refuses a draft without a recipient', () => {
    expect(() => draftToCreateRequest({ ...draft, recipient: null })).toThrow(/recipient/);
  });
});

describe('draftDueDate (D5-ALL B-5)', () => {
  const exact = 1_794_382_804 + 26_028 + 7 * 86_400; // chain time + 7 days, not midnight
  it('keeps the exact parsed timestamp when the date was not edited', () => {
    expect(draftDueDate(exact, '2026-11-18', false)).toBe(exact);
  });
  it('an edited calendar date is stored at 00:00 UTC (A-06)', () => {
    expect(draftDueDate(exact, '2026-11-20', true)).toBe(Date.UTC(2026, 10, 20) / 1000);
  });
});
