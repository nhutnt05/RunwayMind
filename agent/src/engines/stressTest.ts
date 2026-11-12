// Stress tests — docs/06 §3. Pure and deterministic: each scenario re-runs the runway projection (§2.1) with
// modifiers; time comes from the snapshot (chain time), amounts are bigint base units.
import {
  DEFAULT_AGENT_SETTINGS,
  formatUsdc,
  type Amount,
  type ChainSnapshot,
  type ExpectedInflow,
  type RiskClass,
  type RunwayInput,
  type RunwayResult,
  type ScenarioResult,
  type StressScenarioId,
  type StressTestResult,
  type UnixSeconds,
} from '@runwaymind/shared';
import { SECONDS_PER_DAY } from './cashLadder';
import { RUNWAY_HORIZON_DAYS_MAX, baselineRunwayInput, computeRunway } from './runway';

export type StressScenario = Exclude<StressScenarioId, 'BASELINE'>;

/** The 4 SRC scenarios in their fixed output order (docs/06 §3.5). */
export const STRESS_SCENARIO_IDS: readonly StressScenario[] = ['APY_DROP_50', 'POOL_LOCK_14D', 'INFLOW_DELAY_30D', 'EXPENSE_PLUS_20'];

export const APY_DROP_MULTIPLIER_BPS = 5_000; // −50 % (§3.1)
export const POOL_LOCK_DAYS = 14; // §3.2
export const INFLOW_DELAY_DAYS = 30; // §3.3
export const EXPENSE_MULTIPLIER_BPS = 12_000; // +20 % (§3.4)

export const SCENARIO_LABELS: Readonly<Record<StressScenarioId, string>> = {
  BASELINE: 'Baseline',
  APY_DROP_50: 'APY −50%',
  POOL_LOCK_14D: 'Pool locked 14 days',
  INFLOW_DELAY_30D: 'Inflows delayed 30 days',
  EXPENSE_PLUS_20: 'Expenses +20%',
};

const SEVERITY: Readonly<Record<RiskClass, number>> = { SAFE: 0, WATCH: 1, CRITICAL: 2 };
const worse = (a: RiskClass, b: RiskClass): RiskClass => (SEVERITY[a] >= SEVERITY[b] ? a : b);

export interface StressTestOptions {
  /** Subset to run (POST /stress-tests `scenarios`); default all 4. Output keeps the fixed order. */
  scenarios?: readonly StressScenario[];
  /** AgentSettings.minApyBps — APY_DROP_50 is WATCH when the scenario APY falls below it (§3.1). */
  minApyBps?: number;
  includeYield?: boolean;
  horizonDays?: number;
}

function baseInput(snapshot: ChainSnapshot, inflows: ExpectedInflow[], opts: StressTestOptions): RunwayInput {
  return {
    ...baselineRunwayInput(snapshot, inflows),
    includeYield: opts.includeYield ?? true,
    horizonDays: Math.min(opts.horizonDays ?? RUNWAY_HORIZON_DAYS_MAX, RUNWAY_HORIZON_DAYS_MAX),
  };
}

/** Runway input for a scenario: baseline + the scenario's modifier (docs/06 §3.1–§3.4). */
export function scenarioInput(
  id: StressScenarioId,
  snapshot: ChainSnapshot,
  inflows: ExpectedInflow[],
  opts: StressTestOptions = {},
): RunwayInput {
  const base = baseInput(snapshot, inflows, opts);
  const now = snapshot.chainTime;
  switch (id) {
    case 'BASELINE':
      return base;
    case 'APY_DROP_50':
      return { ...base, apyMultiplierBps: APY_DROP_MULTIPLIER_BPS };
    case 'POOL_LOCK_14D':
      return { ...base, lock: { start: now, end: now + POOL_LOCK_DAYS * SECONDS_PER_DAY } };
    case 'INFLOW_DELAY_30D':
      return { ...base, inflowDelaySec: INFLOW_DELAY_DAYS * SECONDS_PER_DAY };
    case 'EXPENSE_PLUS_20':
      return { ...base, expenseMultiplierBps: EXPENSE_MULTIPLIER_BPS };
  }
}

function scenarioParameters(id: StressScenarioId, now: UnixSeconds): Record<string, string | number> {
  switch (id) {
    case 'BASELINE':
      return {};
    case 'APY_DROP_50':
      return { apyMultiplierBps: APY_DROP_MULTIPLIER_BPS };
    case 'POOL_LOCK_14D':
      return { lockDays: POOL_LOCK_DAYS, lockStart: now, lockEnd: now + POOL_LOCK_DAYS * SECONDS_PER_DAY };
    case 'INFLOW_DELAY_30D':
      return { inflowDelayDays: INFLOW_DELAY_DAYS, inflowDelaySec: INFLOW_DELAY_DAYS * SECONDS_PER_DAY };
    case 'EXPENSE_PLUS_20':
      return { expenseMultiplierBps: EXPENSE_MULTIPLIER_BPS };
  }
}

/** Invested adapters whose APY under the −50 % scenario would fall below `minApyBps`. */
function apyBreaches(snapshot: ChainSnapshot, minApyBps: number): string[] {
  return snapshot.adapters
    .filter((a) => a.status !== 'NONE' && a.balance > 0n)
    .filter((a) => (a.apyBps * APY_DROP_MULTIPLIER_BPS) / 10_000 < minApyBps)
    .map((a) => a.name);
}

const usd = (x: Amount) => `${formatUsdc(x)} USDC`;
const dayOf = (t: UnixSeconds, now: UnixSeconds) => Math.floor((t - now) / SECONDS_PER_DAY);

function recommend(
  id: StressScenarioId,
  r: RunwayResult,
  ctx: { snapshot: ChainSnapshot; inflows: ExpectedInflow[]; minApyBps: number },
): ScenarioResult['recommendedAction'] {
  const now = ctx.snapshot.chainTime;
  const failureNote = r.failure
    ? `Obligation #${r.failure.obligationId} due on day ${dayOf(r.failure.at, now)} would miss ${usd(r.failure.missing)}`
    : '';
  switch (id) {
    case 'APY_DROP_50': {
      const breaches = apyBreaches(ctx.snapshot, ctx.minApyBps);
      if (breaches.length) {
        return {
          action: 'NONE',
          amount: null,
          note: `Hypothetical: would trigger APY_BELOW_MINIMUM withdrawal from ${breaches.join(', ')} (min APY ${ctx.minApyBps / 100}%)`,
        };
      }
      break;
    }
    case 'POOL_LOCK_14D':
      if (r.classification === 'CRITICAL' && r.failure) {
        return {
          action: 'WITHDRAW',
          amount: r.failure.missing,
          note: `${failureNote} during a ${POOL_LOCK_DAYS}-day lock: withdraw it now and consider increasing the safety horizon H`,
        };
      }
      break;
    case 'INFLOW_DELAY_30D':
      if (ctx.inflows.length === 0) return { action: 'NONE', amount: null, note: 'No expected inflows registered' };
      if (r.failure) return { action: 'HOLD', amount: r.failure.missing, note: `${failureNote}: do not invest until resolved` };
      break;
    case 'EXPENSE_PLUS_20':
      if (r.shortfallNow > 0n) {
        return {
          action: 'WITHDRAW',
          amount: r.shortfallNow,
          note: `Withdraw ${usd(r.shortfallNow)} to restore the scenario reserve; consider raising the emergency buffer`,
        };
      }
      break;
    case 'BASELINE':
      if (r.shortfallNow > 0n) {
        return { action: 'WITHDRAW', amount: r.shortfallNow, note: `Reserve shortfall of ${usd(r.shortfallNow)} now` };
      }
      break;
  }
  if (r.failure) return { action: 'REVIEW_POLICY', amount: r.failure.missing, note: failureNote };
  return { action: 'NONE', amount: null, note: 'No action needed' };
}

/** Capped runways compare as the horizon (365), docs/06 §3.5. */
const comparable = (r: RunwayResult) => (r.capped ? RUNWAY_HORIZON_DAYS_MAX : r.runwayDays);

/** Runs one scenario (or the baseline). `baseline` is the baseline runway used for `deltaRunwayDays`. */
export function runScenario(
  id: StressScenarioId,
  snapshot: ChainSnapshot,
  inflows: ExpectedInflow[],
  opts: StressTestOptions = {},
  baseline?: RunwayResult,
): ScenarioResult {
  const minApyBps = opts.minApyBps ?? DEFAULT_AGENT_SETTINGS.minApyBps;
  const runway = computeRunway(scenarioInput(id, snapshot, inflows, opts));
  // §3.1: "WATCH if new APY < minApyBps".
  if (id === 'APY_DROP_50' && apyBreaches(snapshot, minApyBps).length) {
    runway.classification = worse(runway.classification, 'WATCH');
  }
  const base = baseline ?? (id === 'BASELINE' ? runway : computeRunway(scenarioInput('BASELINE', snapshot, inflows, opts)));
  return {
    id,
    label: SCENARIO_LABELS[id],
    parameters: scenarioParameters(id, snapshot.chainTime),
    runway,
    deltaRunwayDays: comparable(runway) - comparable(base),
    recommendedAction: recommend(id, runway, { snapshot, inflows, minApyBps }),
  };
}

/**
 * Baseline + the requested scenarios (default all 4, fixed order). `worstCase = argmin(runwayDays)` over the scenarios,
 * ties broken by classification severity, then by fixed order; `overallClassification` = max severity incl. baseline.
 * `ranAt` is the snapshot's chain time (no wall clock in engines).
 */
export function runStressTest(snapshot: ChainSnapshot, inflows: ExpectedInflow[], opts: StressTestOptions = {}): StressTestResult {
  const wanted = opts.scenarios && opts.scenarios.length ? new Set(opts.scenarios) : new Set(STRESS_SCENARIO_IDS);
  const baseline = runScenario('BASELINE', snapshot, inflows, opts);
  const scenarios = STRESS_SCENARIO_IDS.filter((id) => wanted.has(id)).map((id) =>
    runScenario(id, snapshot, inflows, opts, baseline.runway),
  );

  let worst = scenarios[0]!;
  for (const s of scenarios.slice(1)) {
    const d = comparable(s.runway) - comparable(worst.runway);
    if (d < 0 || (d === 0 && SEVERITY[s.runway.classification] > SEVERITY[worst.runway.classification])) worst = s;
  }
  const overallClassification = scenarios.reduce<RiskClass>((c, s) => worse(c, s.runway.classification), baseline.runway.classification);

  return {
    snapshotId: snapshot.snapshotId,
    ranAt: snapshot.chainTime,
    baseline,
    scenarios,
    worstCase: worst.id,
    overallClassification,
  };
}
