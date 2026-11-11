// Formatting helpers. All money is bigint base units (rule 2); no floating point anywhere in this file.
import type { Amount, Bps, UnixSeconds } from './types/ladder';

export const USDC_DECIMALS = 6;
export const BPS_DENOMINATOR = 10_000n;
export const SECONDS_PER_DAY = 86_400;

function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`decimals must be a non-negative integer, got ${n}`);
  return 10n ** BigInt(n);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats base units for display: `formatUsdc(70_030_684_931n) === "70,030.68"`.
 * The fraction is truncated toward zero (never rounds a balance up).
 */
export function formatUsdc(amount: Amount, decimals: number = USDC_DECIMALS, displayDecimals = 2): string {
  if (!Number.isInteger(displayDecimals) || displayDecimals < 0 || displayDecimals > decimals) {
    throw new RangeError(`displayDecimals must be an integer in [0, ${decimals}]`);
  }
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = pow10(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').slice(0, displayDecimals);
  const text = groupThousands(whole.toString()) + (displayDecimals > 0 ? `.${fraction}` : '');
  return negative ? `-${text}` : text;
}

/**
 * Formats base units as a plain decimal string without grouping, e.g. `"70000.00"` — the shape used by
 * `DecisionFacts` (docs/05 §5.3).
 */
export function formatUsdcPlain(amount: Amount, decimals: number = USDC_DECIMALS, displayDecimals = 2): string {
  return formatUsdc(amount, decimals, displayDecimals).replace(/,/g, '');
}

const DECIMAL_INPUT = /^(\d+)(?:\.(\d*))?$/;

/**
 * Parses a user-entered decimal amount into base units: `parseUsdc("70,030.68") === 70_030_680_000n`.
 * Accepts thousands separators (`,`), `_` and surrounding whitespace. Rejects negatives, exponents, more fraction
 * digits than `decimals`, and empty input.
 */
export function parseUsdc(input: string, decimals: number = USDC_DECIMALS): Amount {
  const cleaned = input.trim().replace(/[,_]/g, '');
  const match = DECIMAL_INPUT.exec(cleaned);
  if (!match) throw new Error(`Invalid amount: "${input}"`);
  const wholePart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  if (fractionPart.length > decimals) {
    throw new Error(`Invalid amount: "${input}" has more than ${decimals} decimal places`);
  }
  return BigInt(wholePart) * pow10(decimals) + BigInt(fractionPart.padEnd(decimals, '0') || '0');
}

// ---------------------------------------------------------------------------------------------------------------
// Basis points
// ---------------------------------------------------------------------------------------------------------------

/** `part / whole` in basis points, floor division; 0 when `whole == 0` (docs/04 §1, §4 "total == 0"). */
export function bps(part: Amount, whole: Amount): Bps {
  if (whole <= 0n || part <= 0n) return 0;
  return Number((part * BPS_DENOMINATOR) / whole);
}

/** `amount × bps / 10_000`, floor division (e.g. exposure cap, expense multiplier). */
export function applyBps(amount: Amount, bpsValue: Bps | bigint): Amount {
  const b = typeof bpsValue === 'bigint' ? bpsValue : BigInt(bpsValue);
  return (amount * b) / BPS_DENOMINATOR;
}

/** Basis points as a percent string with 2 decimals: `bpsToPercent(800) === "8.00"`. */
export function bpsToPercent(bpsValue: Bps): string {
  if (!Number.isInteger(bpsValue)) throw new RangeError(`bps must be an integer, got ${bpsValue}`);
  const negative = bpsValue < 0;
  const abs = Math.abs(bpsValue);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

// ---------------------------------------------------------------------------------------------------------------
// Dates (A-06: calendar dates are stored as 00:00:00 UTC of that date)
// ---------------------------------------------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `toUtcMidnight("2026-12-15")` → Unix seconds of 2026-12-15T00:00:00Z. Throws on invalid calendar dates. */
export function toUtcMidnight(isoDate: string): UnixSeconds {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new Error(`Invalid date "${isoDate}", expected YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid calendar date "${isoDate}"`);
  }
  return ms / 1000;
}

/** Inverse of {@link toUtcMidnight} for display: Unix seconds → `YYYY-MM-DD` (UTC). */
export function toIsoDateUtc(ts: UnixSeconds): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
