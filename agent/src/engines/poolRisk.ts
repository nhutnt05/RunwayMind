// Pool Risk Score — docs/06 §4 (0–100, 100 = safest). Pure and deterministic: integer math in centi-points
// (1/100 of a score point) and a fixed 1,000-step log10 lookup table, so every platform gets the same score.
//
// Precision note: sub-scores are combined at centi-point precision and only the final score is rounded. This is
// what the worked examples in docs/06 §4.3 require (crisis: 0.5×12 + 0.3×12.5 + 0.2×63.4 = 22.43 → 22; rounding V to
// 13 first would give 23). `components` report the sub-scores with two decimals for display.
import type { AdapterState, PoolMetricSample, PoolRiskBand, PoolRiskResult, UnixSeconds } from '@runwaymind/shared';

/** Volatility window (docs/06 §4.2). */
export const RISK_SAMPLE_WINDOW = 20;
export const RISK_WEIGHTS = { utilization: 0.5, apyVolatility: 0.3, tvl: 0.2 } as const;
const W_BPS = { utilization: 5000, apyVolatility: 3000, tvl: 2000 } as const;
const FULL = 10_000; // 100.00 points in centi-points

// ---- deterministic log10 ---------------------------------------------------------------------------------------

const LOG_STEPS = 1000;
const MICRO = 1_000_000;
/** LOG10_TABLE[i] = round(log10(1 + 9·i/1000) · 1e6), i = 0..999 — mantissa grid over [1, 10). */
export const LOG10_TABLE: readonly number[] = Array.from({ length: LOG_STEPS }, (_, i) =>
  Math.round(Math.log10(1 + (9 * i) / LOG_STEPS) * MICRO),
);

/** log10(t) in micro-units for an integer t ≥ 1, via exponent + table lookup on the mantissa (floor step). */
export function log10Micro(t: bigint): number {
  if (t < 1n) throw new RangeError('log10Micro needs t >= 1');
  const exponent = t.toString().length - 1;
  const base = 10n ** BigInt(exponent);
  const idx = Number(((t - base) * BigInt(LOG_STEPS)) / (9n * base)); // 0..999
  return exponent * MICRO + LOG10_TABLE[Math.min(idx, LOG_STEPS - 1)]!;
}

// ---- sub-scores (centi-points, 0..10_000) ----------------------------------------------------------------------

/** U: ≤80% → 100; 80–95% → 100 − (u−80)·70/15; >95% → 30 − (u−95)·6 (0 at 100%). */
export function utilizationScore(utilizationBps: number): number {
  const u = Math.max(0, Math.min(FULL, utilizationBps));
  if (u <= 8000) return FULL;
  if (u <= 9500) return FULL - Math.round(((u - 8000) * 70) / 15);
  return Math.max(0, 3000 - (u - 9500) * 6);
}

/** V: over the last N samples, range = (max − min) / max; V = 100·(1 − min(1, range)); max 0 → 0; < 2 samples → 100. */
export function apyVolatilityScore(apys: readonly number[]): number {
  if (apys.length < 2) return FULL;
  const max = Math.max(...apys);
  const min = Math.min(...apys);
  if (max <= 0) return 0;
  const rangeBps = Math.floor(((max - min) * FULL) / max);
  return FULL - Math.min(FULL, rangeBps);
}

/** T: whole-token TVL t; ≤1,000 → 0; ≥1,000,000 → 100; else 100·(log10 t − 3)/3. */
export function tvlScore(tvl: bigint, decimals: number): number {
  const t = tvl / 10n ** BigInt(decimals);
  if (t <= 1_000n) return 0;
  if (t >= 1_000_000n) return FULL;
  return Math.round((FULL * (log10Micro(t) - 3 * MICRO)) / (3 * MICRO));
}

export function riskBand(score: number, thresholds: { riskInvestThreshold: number; riskWithdrawThreshold: number } = { riskInvestThreshold: 70, riskWithdrawThreshold: 40 }): PoolRiskBand {
  if (score >= thresholds.riskInvestThreshold) return 'HEALTHY';
  if (score >= thresholds.riskWithdrawThreshold) return 'WATCH';
  return 'CRITICAL';
}

export interface PoolRiskOptions {
  /** Chain time of the computation (never the wall clock). */
  computedAt: UnixSeconds;
  /** Asset decimals for whole-token TVL (USDC = 6). */
  decimals?: number;
  thresholds?: { riskInvestThreshold: number; riskWithdrawThreshold: number };
}

/**
 * docs/06 §4.4. `history` = PoolMetricSample rows for this adapter (any order, may include the current sample); the
 * newest RISK_SAMPLE_WINDOW samples by `sampledAt` feed V. Current state (`a`) feeds U, T and the pause gate.
 */
export function computePoolRisk(a: AdapterState, history: readonly Pick<PoolMetricSample, 'sampledAt' | 'apyBps'>[], opts: PoolRiskOptions): PoolRiskResult {
  const window = [...history].sort((x, y) => y.sampledAt - x.sampledAt).slice(0, RISK_SAMPLE_WINDOW);
  const u = utilizationScore(a.utilizationBps);
  const v = apyVolatilityScore(window.map((s) => s.apyBps));
  const t = tvlScore(a.tvl, opts.decimals ?? 6);
  const centi = Math.floor((W_BPS.utilization * u + W_BPS.apyVolatility * v + W_BPS.tvl * t) / FULL);
  const score = a.paused ? 0 : Math.max(0, Math.min(100, Math.round(centi / 100)));
  return {
    adapter: a.address,
    score,
    band: riskBand(score, opts.thresholds),
    components: { utilization: u / 100, apyVolatility: v / 100, tvl: t / 100, paused: a.paused },
    weights: { ...RISK_WEIGHTS },
    samplesUsed: window.length,
    computedAt: opts.computedAt,
  };
}

/** One PoolMetricSample per adapter from a chain snapshot (docs/06 §4.1: sampled every agent tick). */
export function sampleFromAdapter(a: AdapterState, chainTime: UnixSeconds, blockNumber: bigint): PoolMetricSample {
  return {
    adapterAddress: a.address,
    sampledAt: chainTime,
    blockNumber,
    apyBps: a.apyBps,
    utilizationBps: a.utilizationBps,
    tvl: a.tvl,
    availableLiquidity: a.availableLiquidity,
    paused: a.paused,
  };
}
