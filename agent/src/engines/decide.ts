// Decision engine — docs/05 §5. Pure and deterministic: (snapshot, ladder, risk, settings) → decision drafts.
// Rules are evaluated in priority order; at most one decision per adapter + one breaker decision.
import {
  bpsToPercent,
  formatUsdcPlain,
  type AdapterState,
  type AgentDecisionDraft,
  type AgentSettings,
  type Amount,
  type CashLadderResult,
  type ChainSnapshot,
  type DecisionFacts,
  type PoolRiskResult,
  type ReasonCode,
} from '@runwaymind/shared';
import { SECONDS_PER_DAY, allocateSources } from './cashLadder';
import { computePoolRisk } from './poolRisk';

const minA = (a: Amount, b: Amount): Amount => (a < b ? a : b);
const max0 = (x: Amount): Amount => (x > 0n ? x : 0n);

export interface DecideContext {
  /** Optional labels for obligations (off-chain metadata), keyed by obligation id. */
  labels?: Readonly<Record<string, string>>;
  /** Optional previous APY per adapter (from metric history) for the explainer facts. */
  previousApyBps?: Readonly<Record<string, number>>;
}

/**
 * Pool Risk Score for an adapter (docs/06 §4). Uses the tick's computed result (with APY history); without one it
 * scores the current state alone (no history → V = 100, §4.5) instead of the old `paused ? 0 : 100` fallback.
 */
export function riskScoreOf(a: AdapterState, risks: readonly PoolRiskResult[]): number {
  const r = risks.find((x) => x.adapter.toLowerCase() === a.address.toLowerCase());
  return r ? r.score : computePoolRisk(a, [], { computedAt: 0 }).score;
}

export function decide(
  s: ChainSnapshot,
  l: CashLadderResult,
  r: readonly PoolRiskResult[],
  cfg: AgentSettings,
  ctx: DecideContext = {},
): AgentDecisionDraft[] {
  const out: AgentDecisionDraft[] = [];
  const decided = new Set<string>(); // adapters that already have a decision this tick
  const key = (a: string) => a.toLowerCase();
  const adapters = s.adapters.filter((a) => a.status !== 'NONE');
  const byAddress = new Map(adapters.map((a) => [key(a.address), a]));
  const score = (a: AdapterState) => riskScoreOf(a, r);
  const facts = (a: AdapterState | null, amount: Amount | null, deadline: number | null) =>
    buildFacts(s, l, cfg, a, amount, deadline, score, ctx);
  const push = (
    action: AgentDecisionDraft['action'],
    a: AdapterState | null,
    amount: Amount | null,
    reasonCode: ReasonCode,
    deadline: number | null = null,
  ) => {
    out.push({ action, adapter: a ? a.address : null, amount, reasonCode, facts: facts(a, amount, deadline), snapshotId: s.snapshotId });
    if (a) decided.add(key(a.address));
  };

  // P1 — shortfall now: withdraw the shortfall, allocated across adapters.
  if (l.shortfall > 0n) {
    const dueNow = l.withdrawalSchedule.find((x) => x.state === 'DUE_NOW');
    const sources = dueNow?.suggestedSources.length
      ? dueNow.suggestedSources
      : allocateSources(l.shortfall, adapters, riskMap(adapters, score)).sources;
    for (const src of sources) {
      const a = byAddress.get(key(src.adapter));
      if (!a || decided.has(key(a.address)) || src.amount <= 0n) continue;
      push('WITHDRAW', a, src.amount, 'DEADLINE_REACHED', s.chainTime);
    }
  }

  // P2 — paused or critical pool with a balance: withdraw everything that is withdrawable.
  const critical = (a: AdapterState) => a.paused || score(a) < cfg.riskWithdrawThreshold;
  for (const a of adapters) {
    if (decided.has(key(a.address)) || a.balance <= 0n || !critical(a)) continue;
    const amount = minA(a.balance, a.availableLiquidity);
    if (amount <= 0n) continue;
    push('WITHDRAW_ALL', a, amount, 'POOL_RISK_CRITICAL');
  }

  // P2b — every ACTIVE adapter is critical: trip the circuit breaker (once).
  const active = adapters.filter((a) => a.status === 'ACTIVE');
  if (!s.circuitBreakerActive && active.length > 0 && active.every(critical)) {
    push('TRIP_CIRCUIT_BREAKER', null, null, 'ALL_POOLS_CRITICAL');
  }

  // P3 — APY below minimum with a balance.
  for (const a of adapters) {
    if (decided.has(key(a.address)) || a.balance <= 0n || a.apyBps >= cfg.minApyBps) continue;
    const amount = minA(a.balance, a.availableLiquidity);
    if (amount <= 0n) continue;
    push('WITHDRAW_ALL', a, amount, 'APY_BELOW_MINIMUM');
  }

  // P4 — next upcoming withdrawal deadline within the lead time.
  const lead = cfg.preWithdrawLeadDays * SECONDS_PER_DAY;
  const next = l.withdrawalSchedule.find((x) => x.deadline > s.chainTime && x.amount > 0n);
  if (next && next.deadline - s.chainTime <= lead) {
    const sources = next.suggestedSources.length
      ? next.suggestedSources
      : allocateSources(next.amount, adapters, riskMap(adapters, score)).sources;
    for (const src of sources) {
      const a = byAddress.get(key(src.adapter));
      if (!a || decided.has(key(a.address)) || src.amount <= 0n) continue;
      push('WITHDRAW', a, src.amount, 'PRE_DEADLINE', next.deadline);
    }
  }
  const p1toP4 = out.length > 0; // any P1–P4 (incl. P2b) decision blocks P6 this tick

  // P5 — watch band: informational HOLD, no new investment into that pool.
  const held = new Set<string>();
  for (const a of active) {
    if (decided.has(key(a.address))) continue;
    const sc = score(a);
    if (sc < cfg.riskInvestThreshold && sc >= cfg.riskWithdrawThreshold) {
      push('HOLD', a, null, 'POOL_RISK_WATCH');
      held.add(key(a.address));
    }
  }

  // P6 — invest idle surplus (only when nothing above fired, no breaker, no on-chain mismatch).
  const mismatch = l.warnings.some((w) => w.code === 'ONCHAIN_MISMATCH');
  if (!p1toP4 && !s.circuitBreakerActive && !mismatch) {
    let r1Headroom = max0(l.idle - l.requiredReserve);
    const candidates = active
      .filter((a) => !decided.has(key(a.address)) && !held.has(key(a.address)))
      .filter((a) => a.apyBps >= cfg.minApyBps && score(a) >= cfg.riskInvestThreshold)
      .sort((a, b) => score(b) - score(a) || b.apyBps - a.apyBps || (a.address < b.address ? -1 : 1));
    for (const a of candidates) {
      const now = l.investableNow.find((x) => key(x.adapter) === key(a.address))?.amount ?? 0n;
      const amount = minA(now, r1Headroom); // R1 headroom is shared across adapters
      if (amount < cfg.minActionAmount) continue;
      push('INVEST', a, amount, 'IDLE_SURPLUS');
      r1Headroom -= amount;
    }
  }
  return out;
}

function riskMap(adapters: readonly AdapterState[], score: (a: AdapterState) => number): Record<string, number> {
  return Object.fromEntries(adapters.map((a) => [a.address, score(a)]));
}

/**
 * Facts for an ADMIN-initiated decision (`reasonCode: MANUAL`, docs/07 §5.5): same grounded numbers as rule
 * decisions, computed from the snapshot and ladder. Pure.
 */
export function manualFacts(
  s: ChainSnapshot,
  l: CashLadderResult,
  cfg: AgentSettings,
  adapter: string | null,
  amount: Amount | null,
): DecisionFacts {
  const a = adapter ? (s.adapters.find((x) => x.address.toLowerCase() === adapter.toLowerCase()) ?? null) : null;
  return buildFacts(s, l, cfg, a, amount, null, (x) => riskScoreOf(x, []), {});
}

function buildFacts(
  s: ChainSnapshot,
  l: CashLadderResult,
  cfg: AgentSettings,
  a: AdapterState | null,
  amount: Amount | null,
  deadline: number | null,
  score: (a: AdapterState) => number,
  ctx: DecideContext,
): DecisionFacts {
  const investable = a ? (l.investableNow.find((x) => x.adapter.toLowerCase() === a.address.toLowerCase())?.amount ?? 0n) : 0n;
  const nextOcc = l.occurrences.find((o) => o.dueDate > s.chainTime) ?? null;
  const prevApy = a ? ctx.previousApyBps?.[a.address] : undefined;
  return {
    chainTime: s.chainTime,
    idle: formatUsdcPlain(l.idle, s.assetDecimals),
    vaultTotal: formatUsdcPlain(l.vaultTotal, s.assetDecimals),
    totalAssets: formatUsdcPlain(l.totalAssets, s.assetDecimals),
    requiredReserve: formatUsdcPlain(l.requiredReserve, s.assetDecimals),
    investableNow: formatUsdcPlain(investable, s.assetDecimals),
    shortfall: formatUsdcPlain(l.shortfall, s.assetDecimals),
    amount: amount === null ? null : formatUsdcPlain(amount, s.assetDecimals),
    adapterName: a ? a.name : null,
    apyPercent: a ? bpsToPercent(a.apyBps) : null,
    previousApyPercent: prevApy === undefined ? null : bpsToPercent(prevApy),
    riskScore: a ? score(a) : null,
    utilizationPercent: a ? bpsToPercent(a.utilizationBps) : null,
    paused: a ? a.paused : null,
    nextObligation: nextOcc
      ? {
          label: ctx.labels?.[nextOcc.obligationId.toString()] ?? `Obligation #${nextOcc.obligationId}`,
          category: nextOcc.category,
          amount: formatUsdcPlain(nextOcc.amount, s.assetDecimals),
          dueInDays: Math.floor((nextOcc.dueDate - s.chainTime) / SECONDS_PER_DAY),
        }
      : null,
    deadlineInDays: deadline === null ? null : Math.floor((deadline - s.chainTime) / SECONDS_PER_DAY),
    safetyHorizonDays: Math.floor(s.policy.safetyHorizonSec / SECONDS_PER_DAY),
    mode: cfg.mode,
  };
}
