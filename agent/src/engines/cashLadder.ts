// Cash Ladder Engine — docs/04. Pure functions only: no I/O, no wall clock (time = snapshot.chainTime, A-03).
// All amounts are bigint base units; percentages are bps with floor division.
import {
  bps,
  formatUsdc,
  type AdapterState,
  type Address,
  type Amount,
  type CashLadderOptions,
  type CashLadderResult,
  type ChainSnapshot,
  type DailyLiquidityPoint,
  type LadderWarning,
  type ObligationOnChain,
  type OccurrenceProjection,
  type UnixSeconds,
  type WithdrawalScheduleItem,
} from '@runwaymind/shared';

export const SECONDS_PER_DAY = 86_400;
export const SECONDS_PER_YEAR = 365n * 86_400n; // MockLendingPool SECONDS_PER_YEAR (docs/02 §0.4)
const BPS = 10_000n;

export const DEFAULT_CASH_LADDER_OPTIONS: CashLadderOptions = {
  projectionDays: 60,
  includeProjectedYield: true,
  maxOccurrencesPerObligation: 1000,
};
export const MAX_PROJECTION_DAYS = 365;

const max0 = (x: Amount): Amount => (x > 0n ? x : 0n);
const minA = (a: Amount, b: Amount): Amount => (a < b ? a : b);

// -----------------------------------------------------------------------------------------------------------------
// Step 1 — expand occurrences (docs/04 §3.1)
// -----------------------------------------------------------------------------------------------------------------

export function withdrawalDeadline(dueDate: UnixSeconds, safetyHorizonSec: number): UnixSeconds {
  return dueDate > safetyHorizonSec ? dueDate - safetyHorizonSec : 0; // saturating, like PolicyEngine
}

export function expandOccurrences(
  obligations: readonly ObligationOnChain[],
  now: UnixSeconds,
  horizonEnd: UnixSeconds,
  cap: number,
  safetyHorizonSec: number,
): OccurrenceProjection[] {
  const out: OccurrenceProjection[] = [];
  for (const ob of obligations) {
    if (ob.status !== 'ACTIVE') continue;
    const remaining =
      ob.interval === 0 ? 1 : ob.maxOccurrences === 0 ? cap : ob.maxOccurrences - ob.paidOccurrences;
    let due = ob.nextDueDate;
    let k = 0;
    while (k < remaining && k < cap && due <= horizonEnd) {
      out.push({
        obligationId: ob.id,
        occurrenceIndex: ob.paidOccurrences + k + 1,
        dueDate: due,
        withdrawalDeadline: withdrawalDeadline(due, safetyHorizonSec),
        amount: ob.amount,
        category: ob.category,
        recipient: ob.recipient,
        state: due <= now ? 'OVERDUE' : due <= now + safetyHorizonSec ? 'IN_WINDOW' : 'SCHEDULED',
      });
      if (ob.interval === 0) break;
      due += ob.interval;
      k += 1;
    }
  }
  return out.sort(compareOccurrences);
}

function compareOccurrences(a: OccurrenceProjection, b: OccurrenceProjection): number {
  if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate;
  if (a.obligationId !== b.obligationId) return a.obligationId < b.obligationId ? -1 : 1;
  return a.occurrenceIndex - b.occurrenceIndex;
}

/** `RequiredReserve(t)` = Σ amounts with `dueDate ≤ t + H` (inclusive, overdue included) + buffer (docs/04 §1). */
export function requiredReserveAt(
  occurrences: readonly OccurrenceProjection[],
  t: UnixSeconds,
  safetyHorizonSec: number,
  emergencyBuffer: Amount,
): Amount {
  const windowEnd = t + safetyHorizonSec;
  let sum = emergencyBuffer;
  for (const o of occurrences) if (o.dueDate <= windowEnd) sum += o.amount;
  return sum;
}

// -----------------------------------------------------------------------------------------------------------------
// Source allocation (docs/04 §3.3)
// -----------------------------------------------------------------------------------------------------------------

export interface AllocationResult {
  sources: { adapter: Address; amount: Amount }[];
  allocated: Amount;
  unallocated: Amount; // > 0 ⇒ LIQUIDITY_RISK
}

/**
 * Orders adapters by (WITHDRAW_ONLY first, then lowest risk = highest Pool Risk Score (A-11), then highest
 * availableLiquidity, then address) and takes from each up to `min(balance, availableLiquidity)`.
 * Adapters with status NONE are ignored. Without scores every adapter ranks equal on risk.
 */
export function allocateSources(
  amount: Amount,
  adapters: readonly AdapterState[],
  riskScores: Readonly<Record<string, number>> = {},
): AllocationResult {
  const candidates = adapters
    .filter((a) => a.status !== 'NONE')
    .slice()
    .sort((a, b) => {
      const wa = a.status === 'WITHDRAW_ONLY' ? 0 : 1;
      const wb = b.status === 'WITHDRAW_ONLY' ? 0 : 1;
      if (wa !== wb) return wa - wb;
      const ra = riskScores[a.address] ?? 100;
      const rb = riskScores[b.address] ?? 100;
      if (ra !== rb) return rb - ra;
      if (a.availableLiquidity !== b.availableLiquidity) return a.availableLiquidity > b.availableLiquidity ? -1 : 1;
      return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1;
    });

  const sources: { adapter: Address; amount: Amount }[] = [];
  let remaining = amount;
  for (const a of candidates) {
    if (remaining <= 0n) break;
    const take = minA(remaining, minA(a.balance, a.availableLiquidity));
    if (take <= 0n) continue;
    sources.push({ adapter: a.address, amount: take });
    remaining -= take;
  }
  return { sources, allocated: amount - max0(remaining), unallocated: max0(remaining) };
}

// -----------------------------------------------------------------------------------------------------------------
// Simulation core shared by Step 3 (schedule, no yield) and Step 4 (daily, optional yield)
// -----------------------------------------------------------------------------------------------------------------

interface SimAdapter {
  state: AdapterState; // mutable copy: balance / availableLiquidity decrease as we withdraw
}

interface SimOccurrence {
  occ: OccurrenceProjection;
  paid: boolean;
  covered: boolean;
}

interface EventOutcome {
  t: UnixSeconds;
  payments: Amount;
  withdrawn: Amount;
  required: Amount;
}

class LadderSimulator {
  idle: Amount;
  readonly adapters: SimAdapter[];
  private readonly occs: SimOccurrence[]; // sorted by dueDate
  private windowPtr = 0; // occs[0..windowPtr) have dueDate <= t + H
  private windowSum = 0n; // Σ unpaid amounts inside the window
  private payPtr = 0; // occs[0..payPtr) have dueDate < current event
  private yieldAccruedTo: UnixSeconds;
  yieldCumulative = 0n;
  readonly schedule: WithdrawalScheduleItem[] = [];
  readonly warnings: LadderWarning[] = [];
  private insolvencyReported = false;

  constructor(
    private readonly s: ChainSnapshot,
    occurrences: readonly OccurrenceProjection[],
    private readonly withYield: boolean,
  ) {
    this.idle = s.idle;
    this.adapters = s.adapters.filter((a) => a.status !== 'NONE').map((a) => ({ state: { ...a } }));
    this.occs = occurrences.map((occ) => ({ occ, paid: false, covered: false }));
    this.yieldAccruedTo = s.chainTime;
    // Payments are only simulated for occurrences due strictly after "now"; overdue ones stay reserved (they
    // remain in RequiredReserve on-chain until paid, so the schedule asks for them at DUE_NOW).
    while (this.payPtr < this.occs.length && this.occs[this.payPtr]!.occ.dueDate < s.chainTime) this.payPtr += 1;
  }

  get vault(): Amount {
    let v = 0n;
    for (const a of this.adapters) v += a.state.balance;
    return v;
  }

  private get H(): number {
    return this.s.policy.safetyHorizonSec;
  }

  private advanceWindow(t: UnixSeconds): void {
    const end = t + this.H;
    while (this.windowPtr < this.occs.length && this.occs[this.windowPtr]!.occ.dueDate <= end) {
      const o = this.occs[this.windowPtr]!;
      if (!o.paid) this.windowSum += o.occ.amount;
      this.windowPtr += 1;
    }
  }

  /** Linear accrual per adapter between accrual points, compounded at each point (docs/02 §E.3). */
  private accrueYield(t: UnixSeconds): void {
    if (!this.withYield || t <= this.yieldAccruedTo) {
      this.yieldAccruedTo = Math.max(this.yieldAccruedTo, t);
      return;
    }
    const dt = BigInt(t - this.yieldAccruedTo);
    for (const a of this.adapters) {
      const interest = (a.state.balance * BigInt(a.state.apyBps) * dt) / (BPS * SECONDS_PER_YEAR);
      a.state.balance += interest;
      this.yieldCumulative += interest;
    }
    this.yieldAccruedTo = t;
  }

  /** Removes `amount` from adapters, liquid sources first, then (keeper retry) any remaining balance. */
  private pullFromVault(amount: Amount): AllocationResult {
    const allocation = allocateSources(
      amount,
      this.adapters.map((a) => a.state),
    );
    for (const src of allocation.sources) {
      const a = this.adapters.find((x) => x.state.address === src.adapter)!;
      a.state.balance -= src.amount;
      a.state.availableLiquidity -= src.amount;
    }
    let rest = allocation.unallocated;
    for (const a of this.adapters) {
      if (rest <= 0n) break;
      const take = minA(rest, a.state.balance);
      a.state.balance -= take;
      rest -= take;
    }
    return allocation;
  }

  private insolvency(t: UnixSeconds, missing: Amount): void {
    if (this.insolvencyReported || missing <= 0n) return;
    this.insolvencyReported = true;
    this.warnings.push({
      code: 'FUTURE_INSOLVENCY',
      message: `Obligations at ${t} exceed total assets by ${formatUsdc(missing)}`,
      amount: missing,
      at: t,
    });
  }

  /** Processes one event time exactly as docs/04 §3.3 (payments first, then reserve evaluation). */
  processEvent(t: UnixSeconds, recordSchedule: boolean): EventOutcome {
    this.accrueYield(t);
    const now = this.s.chainTime;
    let payments = 0n;
    let withdrawn = 0n;

    // 1. payments due at t (keeper pays at due time)
    while (this.payPtr < this.occs.length && this.occs[this.payPtr]!.occ.dueDate <= t) {
      const o = this.occs[this.payPtr]!;
      this.payPtr += 1;
      if (o.occ.dueDate !== t || o.paid) continue;
      o.paid = true;
      if (this.payPtr - 1 < this.windowPtr) this.windowSum -= o.occ.amount;
      payments += o.occ.amount;
      this.idle -= o.occ.amount;
      if (this.idle < 0n) {
        const deficit = -this.idle;
        const vault = this.vault;
        const pulled = minA(deficit, vault);
        this.pullFromVault(pulled);
        withdrawn += pulled;
        this.idle = 0n;
        if (pulled < deficit) this.insolvency(t, deficit - pulled);
      }
    }

    // 2. reserve requirement at t
    this.advanceWindow(t);
    const required = this.windowSum + this.s.policy.emergencyBuffer;
    const need = max0(required - this.idle);
    const covers = recordSchedule ? this.takeCovers(t) : [];

    if (need > 0n) {
      const take = minA(need, this.vault);
      const allocation = this.pullFromVault(take);
      if (recordSchedule) {
        this.schedule.push({
          deadline: t,
          amount: need,
          requiredReserveAfter: required,
          covers,
          suggestedSources: allocation.sources,
          state: t <= now ? 'DUE_NOW' : 'UPCOMING',
        });
        if (allocation.unallocated > 0n) {
          this.warnings.push({
            code: 'LIQUIDITY_RISK',
            message: `Withdrawal of ${formatUsdc(take)} at ${t} exceeds available pool liquidity by ${formatUsdc(allocation.unallocated)}`,
            amount: allocation.unallocated,
            at: t,
          });
        }
      }
      this.idle += take;
      withdrawn += take;
      if (take < need) this.insolvency(t, need - take);
    } else if (recordSchedule && covers.length > 0 && t > now) {
      // A fully-funded "now" is not a schedule event; only future window entries are reported.
      this.schedule.push({
        deadline: t,
        amount: 0n,
        requiredReserveAfter: required,
        covers,
        suggestedSources: [],
        state: 'SATISFIED_BY_IDLE',
      });
    }
    return { t, payments, withdrawn, required };
  }

  /**
   * Unpaid occurrences that enter the reserve window at t (withdrawalDeadline == t). At "now", everything already
   * inside the window that has not been covered yet is attributed to the DUE_NOW item.
   */
  private takeCovers(t: UnixSeconds): WithdrawalScheduleItem['covers'] {
    const isNow = t === this.s.chainTime;
    const out: WithdrawalScheduleItem['covers'] = [];
    for (let i = 0; i < this.windowPtr; i += 1) {
      const o = this.occs[i]!;
      if (o.paid || o.covered) continue;
      const entersNow = o.occ.withdrawalDeadline === t;
      if (entersNow || (isNow && o.occ.withdrawalDeadline <= t)) {
        o.covered = true;
        out.push({
          obligationId: o.occ.obligationId,
          occurrenceIndex: o.occ.occurrenceIndex,
          dueDate: o.occ.dueDate,
          amount: o.occ.amount,
        });
      }
    }
    return out;
  }
}

function eventTimes(occurrences: readonly OccurrenceProjection[], now: UnixSeconds, end: UnixSeconds): UnixSeconds[] {
  const set = new Set<UnixSeconds>([now]);
  for (const o of occurrences) {
    if (o.withdrawalDeadline > now && o.withdrawalDeadline <= end) set.add(o.withdrawalDeadline);
    if (o.dueDate > now && o.dueDate <= end) set.add(o.dueDate);
  }
  return [...set].sort((a, b) => a - b);
}

// -----------------------------------------------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------------------------------------------

export function computeCashLadder(s: ChainSnapshot, o: Partial<CashLadderOptions> = {}): CashLadderResult {
  const opts: CashLadderOptions = { ...DEFAULT_CASH_LADDER_OPTIONS, ...o };
  if (!Number.isInteger(opts.projectionDays) || opts.projectionDays < 0 || opts.projectionDays > MAX_PROJECTION_DAYS) {
    throw new RangeError(`projectionDays must be an integer in [0, ${MAX_PROJECTION_DAYS}]`);
  }
  const now = s.chainTime;
  const H = s.policy.safetyHorizonSec;
  const buffer = s.policy.emergencyBuffer;
  const horizonEnd = now + opts.projectionDays * SECONDS_PER_DAY + H;

  // Step 1
  const occurrences = expandOccurrences(s.obligations, now, horizonEnd, opts.maxOccurrencesPerObligation, H);

  // Step 2 — current figures
  const required = requiredReserveAt(occurrences, now, H, buffer);
  let vaultTotal = 0n;
  for (const a of s.adapters) if (a.status !== 'NONE') vaultTotal += a.balance;
  const totalAssets = s.idle + vaultTotal;
  const investableCapital = max0(totalAssets - required);
  const shortfall = max0(required - s.idle);
  const r1 = max0(s.idle - required);
  const investableNow = s.adapters
    .filter((a) => a.status === 'ACTIVE')
    .map((a) => {
      const cap = (totalAssets * BigInt(s.policy.maxExposureBps)) / BPS;
      const r3 = max0(cap - a.balance);
      return { adapter: a.address, amount: s.circuitBreakerActive ? 0n : minA(r1, r3) };
    });

  const warnings: LadderWarning[] = [];
  if (required !== s.onchainRequiredReserve) {
    warnings.push({
      code: 'ONCHAIN_MISMATCH',
      message: `Engine required reserve ${formatUsdc(required)} != PolicyEngine ${formatUsdc(s.onchainRequiredReserve)}`,
      amount: required > s.onchainRequiredReserve ? required - s.onchainRequiredReserve : s.onchainRequiredReserve - required,
      at: now,
    });
  }
  if (totalAssets < required) {
    warnings.push({
      code: 'UNDERFUNDED',
      message: `Total assets ${formatUsdc(totalAssets)} are below the required reserve ${formatUsdc(required)}`,
      amount: required - totalAssets,
      at: now,
    });
  }
  if (shortfall > 0n) {
    warnings.push({
      code: 'SHORTFALL_NOW',
      message: `Idle balance is ${formatUsdc(shortfall)} below the required reserve; withdraw now`,
      amount: shortfall,
      at: now,
    });
  }
  for (const occ of occurrences) {
    if (occ.state !== 'OVERDUE') continue;
    warnings.push({
      code: 'OVERDUE_OBLIGATION',
      message: `Obligation #${occ.obligationId} occurrence ${occ.occurrenceIndex} is overdue (${formatUsdc(occ.amount)})`,
      amount: occ.amount,
      at: occ.dueDate,
    });
  }
  if (s.circuitBreakerActive) {
    warnings.push({ code: 'CIRCUIT_BREAKER_ACTIVE', message: 'Circuit breaker is active; new investments are blocked' });
  }

  // Step 3 — withdrawal schedule (yield excluded = conservative)
  const scheduleSim = new LadderSimulator(s, occurrences, false);
  for (const t of eventTimes(occurrences, now, horizonEnd)) scheduleSim.processEvent(t, true);
  warnings.push(...scheduleSim.warnings);

  // Step 4 — daily projection (events in (t_{d-1}, t_d] applied exactly as Step 3; optional yield)
  const daily = projectDaily(s, occurrences, opts);

  return {
    snapshotId: s.snapshotId,
    asOf: now,
    totalAssets,
    idle: s.idle,
    vaultTotal,
    requiredReserve: required,
    investableCapital,
    investableNow,
    capitalEfficiencyBps: bps(investableCapital, totalAssets),
    actualEfficiencyBps: bps(vaultTotal, totalAssets),
    shortfall,
    occurrences,
    withdrawalSchedule: scheduleSim.schedule,
    daily,
    warnings,
  };
}

function projectDaily(
  s: ChainSnapshot,
  occurrences: readonly OccurrenceProjection[],
  opts: CashLadderOptions,
): DailyLiquidityPoint[] {
  const now = s.chainTime;
  const lastDay = now + opts.projectionDays * SECONDS_PER_DAY;
  const sim = new LadderSimulator(s, occurrences, opts.includeProjectedYield);
  const events = eventTimes(occurrences, now, lastDay);
  const points: DailyLiquidityPoint[] = [];
  let e = 0;
  for (let d = 0; d <= opts.projectionDays; d += 1) {
    const td = now + d * SECONDS_PER_DAY;
    let paymentsToday = 0n;
    let withdrawalsToday = 0n;
    while (e < events.length && events[e]! <= td) {
      const out = sim.processEvent(events[e]!, false);
      paymentsToday += out.payments;
      withdrawalsToday += out.withdrawn;
      e += 1;
    }
    // Evaluate the day boundary itself (yield accrual + requirement at t_d) without double-paying.
    const atBoundary = sim.processEvent(td, false);
    withdrawalsToday += atBoundary.withdrawn;
    const vault = sim.vault;
    const total = sim.idle + vault;
    points.push({
      dayIndex: d,
      date: td,
      requiredReserve: atBoundary.required,
      projectedIdle: sim.idle,
      projectedVault: vault,
      projectedTotal: total,
      paymentsToday,
      withdrawalsToday,
      projectedYieldCumulative: sim.yieldCumulative,
      deficit: max0(atBoundary.required - total),
    });
  }
  return points;
}
