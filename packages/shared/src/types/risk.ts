// docs/06 §4.4 — Pool Risk Score (0–100, 100 = safest, A-11).
import type { Address, UnixSeconds } from './ladder';

export type PoolRiskBand = 'HEALTHY' | 'WATCH' | 'CRITICAL';

export interface PoolRiskResult {
  adapter: Address;
  score: number; // 0..100, 100 = safest
  band: 'HEALTHY' | 'WATCH' | 'CRITICAL';
  components: { utilization: number; apyVolatility: number; tvl: number; paused: boolean };
  weights: { utilization: 0.5; apyVolatility: 0.3; tvl: 0.2 };
  samplesUsed: number;
  computedAt: UnixSeconds;
}
