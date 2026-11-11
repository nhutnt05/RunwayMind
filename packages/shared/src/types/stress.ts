// docs/06 §1–§3 — runway inputs/outputs and stress scenarios.
import type { Amount, ChainSnapshot, UnixSeconds } from './ladder';

export interface ExpectedInflow {
  // off-chain only (A-09)
  id: string;
  label: string;
  amount: Amount;
  expectedDate: UnixSeconds;
}

export interface RunwayInput {
  snapshot: ChainSnapshot;
  inflows: ExpectedInflow[];
  horizonDays: number; // default 365 (cap)
  includeYield: boolean; // default true
  // scenario modifiers (identity values = baseline)
  apyMultiplierBps: number; // 10_000 = unchanged; 5_000 = −50%
  lock: { start: UnixSeconds; end: UnixSeconds } | null; // vault funds unavailable in [start, end)
  inflowDelaySec: number; // 0 = none
  expenseMultiplierBps: number; // 10_000 = unchanged; 12_000 = +20%
}

export type RiskClass = 'SAFE' | 'WATCH' | 'CRITICAL';

export interface RunwayResult {
  runwayDays: number;
  capped: boolean;
  failure: { at: UnixSeconds; kind: 'SOLVENCY' | 'LIQUIDITY'; obligationId: bigint; missing: Amount } | null;
  bufferBreachAt: UnixSeconds | null;
  minLiquidIdle: Amount; // lowest idle balance observed
  projectedYield: Amount; // over min(horizon, last obligation date)
  shortfallNow: Amount; // required reserve under scenario − idle now
  classification: RiskClass;
}

export type StressScenarioId = 'BASELINE' | 'APY_DROP_50' | 'POOL_LOCK_14D' | 'INFLOW_DELAY_30D' | 'EXPENSE_PLUS_20';

export interface ScenarioResult {
  id: StressScenarioId;
  label: string;
  parameters: Record<string, string | number>;
  runway: RunwayResult;
  deltaRunwayDays: number; // vs baseline (negative = worse); capped values compare as 365
  recommendedAction: { action: 'NONE' | 'WITHDRAW' | 'HOLD' | 'REVIEW_POLICY'; amount: Amount | null; note: string };
}

export interface StressTestResult {
  snapshotId: string;
  ranAt: UnixSeconds;
  baseline: ScenarioResult;
  scenarios: ScenarioResult[]; // exactly the 4 above, in fixed order
  worstCase: StressScenarioId;
  overallClassification: RiskClass; // max severity across scenarios
}
