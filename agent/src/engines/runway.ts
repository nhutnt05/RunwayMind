// Runway projection — docs/06 §2. Pure and deterministic; chain time from the snapshot.
// Event-driven simulation (equivalent to stepping day by day, since state only changes at event times). At each event
// time, in order: (1) inflows received, (2) vault yield accrual, (3) obligation payments due, (4) reserve top-up.
import type {
  Amount,
  ChainSnapshot,
  ExpectedInflow,
  RiskClass,
  RunwayInput,
  RunwayResult,
  UnixSeconds,
} from '@runwaymind/shared';
import { SECONDS_PER_DAY, SECONDS_PER_YEAR, expandOccurrences } from './cashLadder';

const BPS = 10_000n;
const max0 = (x: Amount): Amount => (x > 0n ? x : 0n);
const minA = (a: Amount, b: Amount): Amount => (a < b ? a : b);

export const RUNWAY_HORIZON_DAYS_MAX = 365;

/** Identity scenario modifiers (baseline). */
export function baselineRunwayInput(snapshot: ChainSnapshot, inflows: ExpectedInflow[] = []): RunwayInput {
  return {
    snapshot,
    inflows,
    horizonDays: RUNWAY_HORIZON_DAYS_MAX,
    includeYield: true,
    apyMultiplierBps: 10_000,
    lock: null,
    inflowDelaySec: 0,
    expenseMultiplierBps: 10_000,
  };
}

interface SimOcc {
  obligationId: bigint;
  dueDate: UnixSeconds;
  amount: Amount;
  paid: boolean;
}

interface VaultPosition {
  principal: Amount; // earns yield
  apyBps: bigint;
}

export function computeRunway(input: RunwayInput): RunwayResult {
  const s = input.snapshot;
  const now = s.chainTime;
  const horizonDays = Math.min(input.horizonDays, RUNWAY_HORIZON_DAYS_MAX);
  const end = now + horizonDays * SECONDS_PER_DAY;
  const H = s.policy.safetyHorizonSec;
  const buffer = s.policy.emergencyBuffer;
  const lock = input.lock;
  const locked = (t: UnixSeconds) => lock !== null && t >= lock.start && t < lock.end;

  // Occurrences up to the horizon end + H (so the reserve window at the end is complete), scenario-scaled.
  const occs: SimOcc[] = expandOccurrences(s.obligations, now, end + H, 100_000, H).map((o) => ({
    obligationId: o.obligationId,
    dueDate: o.dueDate,
    amount: (o.amount * BigInt(input.expenseMultiplierBps)) / BPS,
    paid: false,
  }));
  const inflows = input.inflows
    .map((f) => ({ at: f.expectedDate + input.inflowDelaySec, amount: f.amount }))
    .filter((f) => f.at <= end)
    .sort((a, b) => a.at - b.at);

  const vault: VaultPosition[] = s.adapters
    .filter((a) => a.status !== 'NONE' && a.balance > 0n)
    .map((a) => ({ principal: a.balance, apyBps: (BigInt(a.apyBps) * BigInt(input.apyMultiplierBps)) / BPS }));
  let yieldBucket = 0n; // accrued interest: spendable vault value, does not itself compound (simple accrual)
  const vaultTotal = () => vault.reduce((sum, v) => sum + v.principal, 0n) + yieldBucket;

  const requiredAt = (t: UnixSeconds) =>
    occs.reduce((sum, o) => (!o.paid && o.dueDate <= t + H ? sum + o.amount : sum), buffer);

  const withdraw = (amount: Amount): Amount => {
    // Principal first, accrued yield last — matches the docs/06 §2.4 accrual segments (70k → 50k → 40k).
    let rest = amount;
    for (const v of vault) {
      if (rest <= 0n) break;
      const take = minA(rest, v.principal);
      v.principal -= take;
      rest -= take;
    }
    const fromYield = minA(rest, yieldBucket);
    yieldBucket -= fromYield;
    rest -= fromYield;
    return amount - rest;
  };

  // Yield is measured over min(horizon, last obligation date) (docs/06 §2.1 RunwayResult.projectedYield).
  const lastObligation = occs.reduce((m, o) => (o.dueDate <= end && o.dueDate > m ? o.dueDate : m), now);
  const yieldEnd = Math.min(end, lastObligation);
  let accruedTo = now;
  const accrue = (t: UnixSeconds) => {
    const until = Math.min(t, yieldEnd);
    if (input.includeYield && until > accruedTo) {
      const dt = BigInt(until - accruedTo);
      for (const v of vault) yieldBucket += (v.principal * v.apyBps * dt) / (BPS * SECONDS_PER_YEAR);
    }
    accruedTo = Math.max(accruedTo, until);
  };
  let projectedYield = 0n;

  let idle = s.idle;
  let minLiquidIdle = idle;
  let bufferBreachAt: UnixSeconds | null = null;
  let failure: RunwayResult['failure'] = null;
  const shortfallNow = max0(requiredAt(now) - idle);

  const times = new Set<UnixSeconds>([now]);
  for (const o of occs) {
    if (o.dueDate > now && o.dueDate <= end) times.add(o.dueDate);
    const deadline = o.dueDate - H;
    if (deadline > now && deadline <= end) times.add(deadline);
  }
  for (const f of inflows) if (f.at > now) times.add(f.at);
  if (lock && lock.end > now && lock.end <= end) times.add(lock.end);
  if (lock && lock.start > now && lock.start <= end) times.add(lock.start);
  const events = [...times].sort((a, b) => a - b);

  let inflowPtr = 0;
  // Payments: overdue (due < now) are processed at "now" like due ones (the keeper pays them immediately).
  outer: for (const t of events) {
    // (1) inflows received
    while (inflowPtr < inflows.length && inflows[inflowPtr]!.at <= t) idle += inflows[inflowPtr++]!.amount;
    // (2) yield accrual
    const before = yieldBucket;
    accrue(t);
    projectedYield += yieldBucket - before;
    // (3) payments due
    for (const o of occs) {
      if (o.paid || o.dueDate > t) continue;
      if (idle < o.amount) {
        const accessible = locked(t) ? 0n : vaultTotal();
        if (idle + accessible < o.amount) {
          const kind = idle + vaultTotal() >= o.amount ? 'LIQUIDITY' : 'SOLVENCY';
          failure = { at: t, kind, obligationId: o.obligationId, missing: o.amount - idle - accessible };
          break outer;
        }
        idle += withdraw(o.amount - idle);
      }
      idle -= o.amount;
      o.paid = true;
    }
    if (idle < minLiquidIdle) minLiquidIdle = idle;
    // (4) reserve top-up (skipped while locked; deferred top-ups execute at lock.end)
    if (!locked(t)) {
      const need = max0(requiredAt(t) - idle);
      if (need > 0n) idle += withdraw(need);
    }
    if (bufferBreachAt === null && idle + vaultTotal() < buffer) bufferBreachAt = t;
  }

  const runwayDays = failure ? Math.floor((failure.at - now) / SECONDS_PER_DAY) : horizonDays;
  const withdrawableNow = locked(now) ? 0n : s.adapters.reduce((sum, a) => sum + minA(a.balance, a.availableLiquidity), 0n);
  return {
    runwayDays,
    capped: failure === null,
    failure,
    bufferBreachAt,
    minLiquidIdle,
    projectedYield,
    shortfallNow,
    classification: classify(runwayDays, failure !== null, bufferBreachAt, now, shortfallNow, withdrawableNow),
  };
}

/** docs/06 §2.2 (proposed thresholds). */
export function classify(
  runwayDays: number,
  failed: boolean,
  bufferBreachAt: UnixSeconds | null,
  now: UnixSeconds,
  shortfallNow: Amount,
  withdrawableNow: Amount,
): RiskClass {
  if ((failed && runwayDays <= 30) || (shortfallNow > 0n && shortfallNow > withdrawableNow)) return 'CRITICAL';
  const breachWithin90 = bufferBreachAt !== null && bufferBreachAt - now <= 90 * SECONDS_PER_DAY;
  if ((failed && runwayDays <= 90) || breachWithin90 || shortfallNow > 0n) return 'WATCH';
  return 'SAFE';
}
