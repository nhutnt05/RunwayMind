// Pure helpers for the D5 UI (docs/08 §2 RunwayMeter / AccruedYieldTicker, §3.3 NL drafts, §3.6 pools, §3.7 stress).
import { formatUsdc, toUtcMidnight, type CreateObligationRequest, type RiskClass } from '@runwaymind/shared';

// ---- Runway Meter (docs/06 §2.3) --------------------------------------------------------------------------------

export const RUNWAY_CAP_DAYS = 365;

export function runwayLabel(r: { runwayDays: number; capped: boolean }): string {
  return r.capped || r.runwayDays >= RUNWAY_CAP_DAYS ? '365+ days' : `${r.runwayDays} day${r.runwayDays === 1 ? '' : 's'}`;
}

/** 0..1 position on the radial gauge (0–365+). */
export function runwayFraction(days: number): number {
  return Math.max(0, Math.min(1, days / RUNWAY_CAP_DAYS));
}

export const CLASS_COLOR: Record<RiskClass, string> = { SAFE: '#059669', WATCH: '#d97706', CRITICAL: '#dc2626' };

export const SCENARIO_LABEL: Record<string, string> = {
  BASELINE: 'Baseline',
  APY_DROP_50: 'APY −50%',
  POOL_LOCK_14D: 'Pool locked 14 days',
  INFLOW_DELAY_30D: 'Inflows delayed 30 days',
  EXPENSE_PLUS_20: 'Expenses +20%',
};

/** "Worst case: 37 days — Inflows delayed 30 days" (docs/06 §2.3). */
export function worstCaseLine(w: { id: string; runwayDays: number } | null): string | null {
  if (!w) return null;
  return `Worst case: ${runwayLabel({ runwayDays: w.runwayDays, capped: w.runwayDays >= RUNWAY_CAP_DAYS })} — ${SCENARIO_LABEL[w.id] ?? w.id}`;
}

// ---- Accrued yield ticker (docs/08 §2) --------------------------------------------------------------------------

const YEAR_SEC = 365n * 86_400n;

/**
 * Local extrapolation between re-syncs with the pool's simple-accrual formula (docs/02 §E.3):
 * accrued(t) = accruedAtSync + vault × apyBps × elapsed / (10,000 × 365 d). Display only; never sent anywhere.
 */
export function tickAccruedYield(accruedAtSync: bigint, vaultBalance: bigint, apyBps: number, elapsedSec: number): bigint {
  if (elapsedSec <= 0 || apyBps <= 0 || vaultBalance <= 0n) return accruedAtSync;
  return accruedAtSync + (vaultBalance * BigInt(apyBps) * BigInt(Math.floor(elapsedSec))) / (10_000n * YEAR_SEC);
}

/** Vault-weighted APY across adapters (bps) for the ticker. */
export function weightedApyBps(adapters: readonly { balance: string; apyBps: number }[]): number {
  const total = adapters.reduce((s, a) => s + BigInt(a.balance), 0n);
  if (total === 0n) return 0;
  return Number(adapters.reduce((s, a) => s + BigInt(a.balance) * BigInt(a.apyBps), 0n) / total);
}

// ---- stress scenarios (docs/06 §3.5) ----------------------------------------------------------------------------

export interface ScenarioJson {
  id: string;
  label: string;
  parameters: Record<string, string | number>;
  runway: {
    runwayDays: number;
    capped: boolean;
    classification: RiskClass;
    shortfallNow: string;
    minLiquidIdle: string;
    projectedYield: string;
    failure: { at: number; kind: string; obligationId: string; missing: string } | null;
  };
  deltaRunwayDays: number;
  recommendedAction: { action: 'NONE' | 'WITHDRAW' | 'HOLD' | 'REVIEW_POLICY'; amount: string | null; note: string };
}

/** The single number each ScenarioCard highlights (docs/06 §3.5 "Key number"). */
export function scenarioKeyNumber(s: ScenarioJson): string {
  const usd = (v: string) => `${formatUsdc(BigInt(v))} USDC`;
  if (s.runway.failure) return `Fails: missing ${usd(s.runway.failure.missing)}`;
  if (BigInt(s.runway.shortfallNow) > 0n) return `Shortfall now ${usd(s.runway.shortfallNow)}`;
  if (s.id === 'POOL_LOCK_14D') return `Min idle ${usd(s.runway.minLiquidIdle)}`;
  return `Projected yield ${usd(s.runway.projectedYield)}`;
}

// ---- NL drafts (docs/07 §5.4) -----------------------------------------------------------------------------------

export interface DraftJson {
  draftId: string;
  label: string;
  category: CreateObligationRequest['category'];
  recipient: string | null;
  amount: string; // base units
  firstDueDate: number;
  interval: number;
  maxOccurrences: number;
  warnings: string[];
  sourceSpan: string;
}

export const WARNING_TEXT: Record<string, string> = {
  RECIPIENT_MISSING: 'No wallet address found — enter the recipient.',
  DUE_DATE_IN_PAST: 'Due date is in the past.',
  MONTHLY_APPROXIMATED_30_DAYS: 'Monthly is stored as every 30 days.',
  AMOUNT_EXCEEDS_TREASURY: 'Amount exceeds total treasury assets.',
  RECIPIENT_IS_TREASURY: 'Recipient is the Treasury itself.',
};

/** Reviewed draft → POST /obligations body (source NL, linked by nlDraftId). Amount stays a base-unit string. */
export function draftToCreateRequest(d: DraftJson): CreateObligationRequest {
  if (!d.recipient) throw new Error(`"${d.label}": enter a recipient address first`);
  return {
    label: d.label,
    notes: null,
    category: d.category,
    recipient: d.recipient as CreateObligationRequest['recipient'],
    amount: d.amount,
    firstDueDate: d.firstDueDate,
    interval: d.interval,
    maxOccurrences: d.maxOccurrences,
    source: 'NL',
    nlDraftId: d.draftId,
  };
}

/**
 * Due date to submit for a reviewed draft: the parser's exact timestamp (e.g. chain time + 7 days for "in 7 days")
 * unless the operator edited the date field, in which case the edited calendar date is stored at 00:00 UTC (A-06).
 */
export function draftDueDate(originalFirstDueDate: number, dateText: string, dateEdited: boolean): number {
  return dateEdited ? toUtcMidnight(dateText) : originalFirstDueDate;
}
