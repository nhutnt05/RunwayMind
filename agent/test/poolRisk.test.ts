// docs/06 §4.3 worked examples (87 / 93 / 22 / 0) and §4.5 edge cases.
import { describe, expect, it } from 'vitest';
import type { AdapterState } from '@runwaymind/shared';
import {
  LOG10_TABLE,
  apyVolatilityScore,
  computePoolRisk,
  log10Micro,
  riskBand,
  sampleFromAdapter,
  tvlScore,
  utilizationScore,
} from '../src/engines/poolRisk';
import { ADAPTER, USDC } from './fixtures';

const T0 = 1_793_318_400;
const pool = (over: Partial<AdapterState> = {}): AdapterState => ({
  address: ADAPTER,
  name: 'Mock Lending Pool (mUSDC)',
  status: 'ACTIVE',
  balance: 0n,
  apyBps: 800,
  paused: false,
  availableLiquidity: USDC(10_000),
  utilizationBps: 5000,
  tvl: USDC(10_000),
  ...over,
});
const stable = (apy: number, n = 20) => Array.from({ length: n }, (_, i) => ({ sampledAt: T0 + i * 60, apyBps: apy }));
const opts = { computedAt: T0 };

describe('poolRisk worked examples (docs/06 §4.3)', () => {
  it('poolRisk_d0: util 50%, APY 8% stable, cash 10,000 → U 100, V 100, T 33.33 → 87 HEALTHY', () => {
    const r = computePoolRisk(pool(), stable(800), opts);
    expect(r.score).toBe(87);
    expect(r.band).toBe('HEALTHY');
    expect(r.components).toEqual({ utilization: 100, apyVolatility: 100, tvl: 33.33, paused: false });
    expect(r.weights).toEqual({ utilization: 0.5, apyVolatility: 0.3, tvl: 0.2 });
    expect(r.samplesUsed).toBe(20);
    expect(r.computedAt).toBe(T0);
  });

  it('poolRisk_afterInvest: cash 80,000 → T ≈ 63.4 → 93 HEALTHY', () => {
    const r = computePoolRisk(pool({ tvl: USDC(80_000) }), stable(800), opts);
    expect(r.components.tvl).toBeCloseTo(63.4, 1);
    expect(r.score).toBe(93);
  });

  it('poolRisk_crisis: util 98%, APY 8% → 1% in window, cash 80,030 → U 12, V 12.5, T 63.4 → 22 CRITICAL', () => {
    const history = [...stable(800, 19), { sampledAt: T0 + 10_000, apyBps: 100 }];
    const r = computePoolRisk(pool({ utilizationBps: 9800, apyBps: 100, tvl: 80_030_000_000n }), history, opts);
    expect(r.components.utilization).toBe(12);
    expect(r.components.apyVolatility).toBe(12.5);
    expect(r.components.tvl).toBeCloseTo(63.4, 1);
    expect(r.score).toBe(22);
    expect(r.band).toBe('CRITICAL');
  });

  it('poolRisk_paused → 0 CRITICAL (components still reported)', () => {
    const r = computePoolRisk(pool({ paused: true }), stable(800), opts);
    expect(r.score).toBe(0);
    expect(r.band).toBe('CRITICAL');
    expect(r.components.paused).toBe(true);
    expect(r.components.utilization).toBe(100);
  });
});

describe('poolRisk edge cases (docs/06 §4.5)', () => {
  it('poolRisk_fewSamples: < 2 samples → V = 100, samplesUsed reported', () => {
    expect(computePoolRisk(pool(), [], opts)).toMatchObject({ samplesUsed: 0, components: { apyVolatility: 100 } });
    expect(computePoolRisk(pool(), stable(800, 1), opts)).toMatchObject({ samplesUsed: 1, components: { apyVolatility: 100 } });
  });

  it('poolRisk_apyZero: max APY 0 → V = 0', () => {
    expect(apyVolatilityScore([0, 0, 0])).toBe(0);
    expect(computePoolRisk(pool({ apyBps: 0 }), stable(0), opts).components.apyVolatility).toBe(0);
  });

  it('poolRisk_tvlZero: TVL 0 → T = 0; ≤ 1,000 → 0; ≥ 1,000,000 → 100', () => {
    expect(tvlScore(0n, 6)).toBe(0);
    expect(tvlScore(USDC(1_000), 6)).toBe(0);
    expect(tvlScore(USDC(1_000_000), 6)).toBe(10_000);
    expect(tvlScore(USDC(5_000_000), 6)).toBe(10_000);
    expect(computePoolRisk(pool({ tvl: 0n }), stable(800), opts).components.tvl).toBe(0);
  });

  it('poolRisk_withdrawOnly: WITHDRAW_ONLY adapters are still scored', () => {
    expect(computePoolRisk(pool({ status: 'WITHDRAW_ONLY' }), stable(800), opts).score).toBe(87);
  });

  it('only the newest 20 samples count (an old APY spike drops out)', () => {
    const old = { sampledAt: T0 - 100_000, apyBps: 5000 };
    expect(computePoolRisk(pool(), [old, ...stable(800, 20)], opts)).toMatchObject({ samplesUsed: 20, components: { apyVolatility: 100 } });
    expect(computePoolRisk(pool(), [old, ...stable(800, 19)], opts).components.apyVolatility).toBeLessThan(100);
  });
});

describe('poolRisk building blocks', () => {
  it('utilization curve breakpoints', () => {
    expect(utilizationScore(8000)).toBe(10_000);
    expect(utilizationScore(9500)).toBe(3000);
    expect(utilizationScore(8750)).toBe(6500);
    expect(utilizationScore(10_000)).toBe(0);
  });

  it('deterministic log10: 1,000-step table, exact powers of ten', () => {
    expect(LOG10_TABLE).toHaveLength(1000);
    expect(LOG10_TABLE[0]).toBe(0);
    expect(log10Micro(10_000n)).toBe(4_000_000);
    expect(log10Micro(1_000_000n)).toBe(6_000_000);
    expect(Math.abs(log10Micro(80_030n) - Math.round(Math.log10(80_030) * 1e6))).toBeLessThan(500);
  });

  it('bands use the agent thresholds (≥70 HEALTHY, 40–69 WATCH, <40 CRITICAL)', () => {
    expect([riskBand(70), riskBand(69), riskBand(40), riskBand(39)]).toEqual(['HEALTHY', 'WATCH', 'WATCH', 'CRITICAL']);
  });

  it('sampleFromAdapter copies the metrics at chain time', () => {
    expect(sampleFromAdapter(pool(), T0, 5n)).toMatchObject({ adapterAddress: ADAPTER, sampledAt: T0, blockNumber: 5n, apyBps: 800, tvl: USDC(10_000) });
  });
});

describe('poolRisk in the agent tick (D5-B1 sampling)', () => {
  it('poolRisk_tick: each tick persists one sample + risk snapshot per adapter; APY history drives P2', async () => {
    const { AuditLogger, MemoryAuditSink } = await import('../src/audit/audit');
    const { MemoryAgentStore } = await import('../src/orchestrator/store');
    const { createAgentLoop } = await import('../src/orchestrator/tick');
    const { investedSnapshot } = await import('./fixtures');
    const store = new MemoryAgentStore(() => new Date('2026-11-11T00:00:00Z'));
    let snap = investedSnapshot();
    const loop = createAgentLoop({
      client: {} as never,
      addresses: { treasury: '0x00000000000000000000000000000000000000f1', registry: '0x00000000000000000000000000000000000000f3', policy: '0x00000000000000000000000000000000000000f4' },
      store,
      audit: new AuditLogger(new MemoryAuditSink()),
      readSnapshot: async () => snap,
    });
    await loop.tick();
    expect(store.poolSamples).toHaveLength(1);
    expect(store.poolRisks[0]).toMatchObject({ band: 'HEALTHY', snapshotId: snap.snapshotId });

    // Crisis: APY 8% → 1% and utilization 98% — the stored 8% sample makes V collapse → CRITICAL → WITHDRAW_ALL (P2).
    const a = snap.adapters[0]!;
    snap = { ...snap, snapshotId: 'snap-crisis', chainTime: snap.chainTime + 60, adapters: [{ ...a, apyBps: 100, utilizationBps: 9800 }] };
    const r = await loop.tick();
    const risk = store.poolRisks.at(-1)!;
    expect(risk.band).toBe('CRITICAL');
    expect(risk.components.apyVolatility).toBe(12.5);
    expect(store.poolSamples).toHaveLength(2);
    expect(r.created.map((d) => [d.action, d.reasonCode])).toContainEqual(['WITHDRAW_ALL', 'POOL_RISK_CRITICAL']);
  });
});
