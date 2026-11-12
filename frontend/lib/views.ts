// Pure display helpers for the D4 pages (docs/08 §3.2–§3.10). No I/O; amounts stay bigint / decimal strings.
import { formatUsdc } from '@runwaymind/shared';
import type { DecodedContractError } from './api';
import { formatDecodedError } from './preparedTx';

const max0 = (x: bigint) => (x > 0n ? x : 0n);
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ---- policy headroom (docs/08 §3.5 "max investable now") ------------------------------------------------------

export interface Headroom {
  /** R1: idle − requiredReserve. */
  r1: bigint;
  /** R3: totalAssets × maxExposureBps / 10,000 − adapter balance. */
  r3: bigint;
  /** min(R1, R3); 0 while the circuit breaker is active (R6) or the adapter is not ACTIVE (R4). */
  maxInvestable: bigint;
}

/** Mirrors PolicyEngine.maxInvestable / Treasury.maxInvestable (docs/02 §C.4) for display. */
export function policyHeadroom(input: {
  idle: bigint;
  requiredReserve: bigint;
  totalAssets: bigint;
  maxExposureBps: number;
  adapterBalance: bigint;
  adapterActive: boolean;
  circuitBreakerActive: boolean;
}): Headroom {
  const r1 = max0(input.idle - input.requiredReserve);
  const r3 = max0((input.totalAssets * BigInt(input.maxExposureBps)) / 10_000n - input.adapterBalance);
  const blocked = input.circuitBreakerActive || !input.adapterActive;
  return { r1, r3, maxInvestable: blocked ? 0n : minB(r1, r3) };
}

// ---- role badges (docs/08 §3.9) -------------------------------------------------------------------------------

export type RoleBadge = 'ADMIN' | 'AGENT' | 'KEEPER' | 'OTHER';

export function txRole(from: string, roles: { admin?: string | null; agent?: string | null; keeper?: string | null }): RoleBadge {
  if (same(from, roles.admin)) return 'ADMIN';
  if (same(from, roles.agent)) return 'AGENT';
  if (same(from, roles.keeper)) return 'KEEPER';
  return 'OTHER';
}

// ---- policy-blocked actions (docs/08 §3.8: "Blocked by R1 Reserve Ratio: idle after 10,000 < required 30,000") --

/** Custom error → policy rule (same mapping as agent/src/chain/errors.ts POLICY_RULE_BY_ERROR). */
export const POLICY_RULE_BY_ERROR: Readonly<Record<string, string>> = {
  ReserveViolation: 'R1 Reserve Ratio',
  ExposureLimitExceeded: 'R3 Exposure Limit',
  AdapterNotWhitelisted: 'R4 Whitelist',
  CircuitBreakerActive: 'R6 Circuit Breaker',
};

export function blockedLabel(err: DecodedContractError | null | undefined): string {
  if (!err) return 'Blocked by policy';
  const rule = POLICY_RULE_BY_ERROR[err.name];
  const args = err.args as Record<string, unknown>;
  let detail = formatDecodedError(err);
  if (err.name === 'ReserveViolation' && args && 'idleAfter' in args && 'requiredReserve' in args) {
    detail = `idle after ${formatUsdc(BigInt(String(args.idleAfter)))} < required ${formatUsdc(BigInt(String(args.requiredReserve)))}`;
  } else if (err.name === 'ExposureLimitExceeded' && args && 'adapterBalanceAfter' in args && 'cap' in args) {
    detail = `adapter balance after ${formatUsdc(BigInt(String(args.adapterBalanceAfter)))} > cap ${formatUsdc(BigInt(String(args.cap)))}`;
  }
  return rule ? `Blocked by ${rule}: ${detail}` : `Blocked by policy: ${detail}`;
}

// ---- liquidity projection chart (docs/08 §3.4) ----------------------------------------------------------------

export interface DailyPointJson {
  dayIndex: number;
  date: number;
  requiredReserve: string;
  projectedIdle: string;
  projectedVault: string;
  paymentsToday: string;
  withdrawalsToday: string;
}

export interface ChartRow {
  day: number;
  /** Whole-token values for the chart geometry only; exact amounts are kept in `exact` for the tooltip. */
  idleTokens: number;
  vaultTokens: number;
  requiredTokens: number;
  paymentsTokens: number;
  exact: { idle: string; vault: string; required: string; payments: string };
}

/** Base units → whole tokens (floor) for chart scaling. Never used for any amount that is sent anywhere. */
export function toChartTokens(baseUnits: string, decimals = 6): number {
  return Number(BigInt(baseUnits) / 10n ** BigInt(decimals));
}

export function ladderChartRows(daily: readonly DailyPointJson[], decimals = 6): ChartRow[] {
  return daily.map((p) => ({
    day: p.dayIndex,
    idleTokens: toChartTokens(p.projectedIdle, decimals),
    vaultTokens: toChartTokens(p.projectedVault, decimals),
    requiredTokens: toChartTokens(p.requiredReserve, decimals),
    paymentsTokens: toChartTokens(p.paymentsToday, decimals),
    exact: { idle: p.projectedIdle, vault: p.projectedVault, required: p.requiredReserve, payments: p.paymentsToday },
  }));
}

// ---- unit conversions for forms (no floating point) -----------------------------------------------------------

/** "70" | "70.5" | "70.25" → bps (7000 / 7050 / 7025). Returns null for anything else. */
export function percentToBps(input: string): number | null {
  const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

/** bps → "70.00" (string math). */
export function bpsToPercentText(bps: number): string {
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;
}

export const SECONDS_PER_DAY = 86_400;

/** Whole days → seconds; null unless a positive integer. */
export function daysToSeconds(input: string): number | null {
  if (!/^\d{1,3}$/.test(input.trim())) return null;
  const d = Number(input.trim());
  return d > 0 ? d * SECONDS_PER_DAY : null;
}

// ---- agent activity (docs/07 §4.7 GET /agent/activity) --------------------------------------------------------

export type ActivityType = 'DECISION' | 'ACTION' | 'KEEPER_RUN';

export interface ActivityItemJson {
  type: ActivityType;
  at: number;
  id: string;
  data: Record<string, unknown>;
}

/** An activity row is "blocked" when its decision/action ended BLOCKED_BY_POLICY (shown red, docs/08 §3.8). */
export function isBlocked(item: ActivityItemJson): boolean {
  return item.data.status === 'BLOCKED_BY_POLICY';
}

/** Decoded error carried by an activity row: an action's own error or a decision's latest action error. */
export function activityError(item: ActivityItemJson): DecodedContractError | null {
  if (item.type === 'ACTION') return (item.data.decodedError as DecodedContractError | null) ?? null;
  if (item.type === 'DECISION') {
    const actions = (item.data.actions as { decodedError: DecodedContractError | null }[] | undefined) ?? [];
    for (let i = actions.length - 1; i >= 0; i--) if (actions[i]?.decodedError) return actions[i]!.decodedError;
  }
  return null;
}

export function filterActivity(items: readonly ActivityItemJson[], type: ActivityType | 'ALL'): ActivityItemJson[] {
  return type === 'ALL' ? [...items] : items.filter((i) => i.type === type);
}
