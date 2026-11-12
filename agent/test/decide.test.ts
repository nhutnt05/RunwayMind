import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SETTINGS, type PoolRiskResult } from '@runwaymind/shared';
import { computeCashLadder } from '../src/engines/cashLadder';
import { decide, riskScoreOf } from '../src/engines/decide';
import { ADAPTER, ADAPTER2, DAY, T0, USDC, adapter, investedSnapshot, obligation, snapshot } from './fixtures';

const cfg = DEFAULT_AGENT_SETTINGS;

function risk(score: number, address = ADAPTER): PoolRiskResult {
  return {
    adapter: address,
    score,
    band: score >= 70 ? 'HEALTHY' : score >= 40 ? 'WATCH' : 'CRITICAL',
    components: { utilization: 0, apyVolatility: 0, tvl: 0, paused: false },
    weights: { utilization: 0.5, apyVolatility: 0.3, tvl: 0.2 },
    samplesUsed: 2,
    computedAt: T0,
  };
}

function run(s: ReturnType<typeof snapshot>, risks: PoolRiskResult[] = []) {
  return decide(s, computeCashLadder(s), risks, cfg);
}

describe('decide (docs/05 §5.2, docs/10 §4.6)', () => {
  it('decide_P6_invest: INVEST 70,000 at D0 with documented facts (docs/05 §5.4)', () => {
    const out = run(snapshot(), [risk(87)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ action: 'INVEST', adapter: ADAPTER, amount: 70_000_000_000n, reasonCode: 'IDLE_SURPLUS' });
    expect(out[0]!.facts).toMatchObject({
      idle: '100000.00',
      requiredReserve: '30000.00',
      investableNow: '70000.00',
      apyPercent: '8.00',
      riskScore: 87,
      safetyHorizonDays: 14,
      mode: 'APPROVE',
    });
  });

  it('decide_P1_shortfall: WITHDRAW the shortfall', () => {
    // D16 with nothing withdrawn yet: idle 10k, required 30k → shortfall 20k.
    const s = investedSnapshot({
      chainTime: T0 + 16 * DAY,
      idle: USDC(10_000),
      obligations: [obligation(2, USDC(20_000), T0 + 30 * DAY), obligation(3, USDC(10_000), T0 + 45 * DAY)],
    });
    const out = run(s);
    expect(out).toEqual([
      expect.objectContaining({ action: 'WITHDRAW', adapter: ADAPTER, amount: USDC(20_000), reasonCode: 'DEADLINE_REACHED' }),
    ]);
  });

  it('decide_P2_criticalPool: WITHDRAW_ALL with POOL_RISK_CRITICAL (demo crisis numbers) + P2b breaker', () => {
    const s = investedSnapshot({
      chainTime: T0 + 2 * DAY,
      adapters: [adapter(70_030_684_931n, { apyBps: 100, utilizationBps: 9800 })],
    });
    const out = decide(s, computeCashLadder(s), [risk(22)], cfg, { previousApyBps: { [ADAPTER]: 800 } });
    expect(out[0]).toMatchObject({ action: 'WITHDRAW_ALL', amount: 70_030_684_931n, reasonCode: 'POOL_RISK_CRITICAL' });
    expect(out[0]!.facts).toMatchObject({
      apyPercent: '1.00',
      previousApyPercent: '8.00',
      utilizationPercent: '98.00',
      riskScore: 22,
      nextObligation: { category: 'PAYROLL', amount: '20000.00', dueInDays: 5 },
    });
    // Single ACTIVE adapter is critical → P2b also fires.
    expect(out[1]).toMatchObject({ action: 'TRIP_CIRCUIT_BREAKER', adapter: null, amount: null, reasonCode: 'ALL_POOLS_CRITICAL' });
    expect(out.some((d) => d.action === 'INVEST')).toBe(false);
  });

  it('paused pool counts as critical; amount capped at available liquidity', () => {
    const s = investedSnapshot({ adapters: [adapter(USDC(70_000), { paused: true, availableLiquidity: USDC(5_000) })] });
    const out = run(s);
    expect(out[0]).toMatchObject({ action: 'WITHDRAW_ALL', amount: USDC(5_000), reasonCode: 'POOL_RISK_CRITICAL' });
  });

  it('decide_P3_lowApy: WITHDRAW_ALL APY_BELOW_MINIMUM', () => {
    const s = investedSnapshot({ adapters: [adapter(USDC(70_000), { apyBps: 250 })] });
    const out = run(s, [risk(90)]);
    expect(out).toEqual([
      expect.objectContaining({ action: 'WITHDRAW_ALL', amount: USDC(70_000), reasonCode: 'APY_BELOW_MINIMUM' }),
    ]);
  });

  it('decide_P4_preDeadline: WITHDRAW 20,000 two days before D16', () => {
    const s = investedSnapshot({
      chainTime: T0 + 14 * DAY,
      idle: USDC(10_000),
      obligations: [obligation(2, USDC(20_000), T0 + 30 * DAY), obligation(3, USDC(10_000), T0 + 45 * DAY)],
      onchainRequiredReserve: USDC(10_000),
    });
    const out = run(s, [risk(90)]);
    expect(out).toEqual([
      expect.objectContaining({ action: 'WITHDRAW', amount: USDC(20_000), reasonCode: 'PRE_DEADLINE' }),
    ]);
    expect(out[0]!.facts.deadlineInDays).toBe(2);
    // 3 days before: nothing to do yet (and idle surplus is 0 → no invest)
    const early = run({ ...s, chainTime: T0 + 13 * DAY }, [risk(90)]);
    expect(early.some((d) => d.reasonCode === 'PRE_DEADLINE')).toBe(false);
  });

  it('P5: watch band → HOLD, no new investment', () => {
    const out = run(snapshot(), [risk(55)]);
    expect(out).toEqual([expect.objectContaining({ action: 'HOLD', amount: null, reasonCode: 'POOL_RISK_WATCH' })]);
  });

  it('decide_mismatch_suppressesInvest: no INVEST when ONCHAIN_MISMATCH', () => {
    const out = run(snapshot({ onchainRequiredReserve: USDC(29_999) }), [risk(87)]);
    expect(out.some((d) => d.action === 'INVEST')).toBe(false);
  });

  it('no INVEST while the breaker is active or below minActionAmount / minApy / risk threshold', () => {
    expect(run(snapshot({ circuitBreakerActive: true }), [risk(87)])).toEqual([]);
    expect(run(snapshot({ idle: USDC(30_000) + 99_999_999n }), [risk(87)])).toEqual([]); // 99.999999 < 100 USDC
    expect(run(snapshot({ adapters: [adapter(0n, { apyBps: 299 })] }), [risk(87)])).toEqual([]);
    expect(run(snapshot(), [risk(69)])).toEqual([expect.objectContaining({ action: 'HOLD' })]);
  });

  it('P6 recomputes shared R1 headroom across adapters (best score first)', () => {
    const s = snapshot({
      adapters: [adapter(0n), adapter(0n, { address: ADAPTER2 })],
      policy: { safetyHorizonSec: 14 * DAY, emergencyBuffer: USDC(10_000), maxExposureBps: 5000 },
    });
    const out = run(s, [risk(80, ADAPTER), risk(95, ADAPTER2)]);
    expect(out.map((d) => [d.adapter, d.amount])).toEqual([
      [ADAPTER2, USDC(50_000)], // R3 cap 50k
      [ADAPTER, USDC(20_000)], // remaining R1 headroom 70k − 50k
    ]);
  });

  it('risk without a tick result: Pool Risk Score of the current state, no history (D5-B1, docs/06 §4.5)', () => {
    expect(riskScoreOf(adapter(0n), [])).toBe(87); // util 50%, V 100 (no samples), cash 10,000 → T 33.3
    expect(riskScoreOf(adapter(0n, { paused: true }), [])).toBe(0);
    expect(riskScoreOf(adapter(0n, { utilizationBps: 9800 }), [])).toBe(43); // 0.5×12 + 0.3×100 + 0.2×33.3
    expect(riskScoreOf(adapter(0n), [risk(22)])).toBe(22); // tick result wins
  });

  it('is deterministic', () => {
    const s = snapshot();
    expect(run(s, [risk(87)])).toEqual(run(s, [risk(87)]));
  });
});
