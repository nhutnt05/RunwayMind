// Pure helpers for the D5 UI (docs/08 §2 AccruedYieldTicker, §3.3 NL drafts, §3.6 pools).
import { toUtcMidnight, type CreateObligationRequest } from '@runwaymind/shared';

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
