// Verbatim from docs/04 §2.1 (Cash Ladder Engine). Reused by docs 05–09.
// `computeCashLadder` itself is implemented in agent/src/engines/cashLadder.ts.

export type Address = `0x${string}`;
export type UnixSeconds = number; // safe integer; chain time
export type Amount = bigint; // token base units (6 decimals for USDC)
export type Bps = number; // 0..10_000

export type Category = 'PAYROLL' | 'GRANT' | 'VENDOR_INVOICE' | 'OTHER';
export type ObligationStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type AdapterStatus = 'NONE' | 'ACTIVE' | 'WITHDRAW_ONLY';

export interface ObligationOnChain {
  id: bigint;
  recipient: Address;
  amount: Amount;
  nextDueDate: UnixSeconds;
  interval: number; // seconds; 0 = one-time
  maxOccurrences: number; // 0 = unlimited (recurring only)
  paidOccurrences: number;
  category: Category;
  status: ObligationStatus;
  metadataHash: `0x${string}`;
  createdAt: UnixSeconds;
}

export interface PolicyParams {
  safetyHorizonSec: number; // H
  emergencyBuffer: Amount;
  maxExposureBps: Bps;
}

export interface AdapterState {
  address: Address;
  name: string;
  status: AdapterStatus;
  balance: Amount;
  apyBps: Bps;
  paused: boolean;
  availableLiquidity: Amount;
  utilizationBps: Bps;
  tvl: Amount;
}

export interface ChainSnapshot {
  snapshotId: string; // uuid
  chainId: 43113;
  blockNumber: bigint;
  chainTime: UnixSeconds; // Treasury.currentTime()
  treasury: Address;
  asset: Address;
  assetDecimals: number;
  idle: Amount;
  adapters: AdapterState[];
  obligations: ObligationOnChain[]; // ACTIVE only
  policy: PolicyParams;
  circuitBreakerActive: boolean;
  demoMode: boolean;
  timeOffset: number;
  onchainRequiredReserve: Amount; // PolicyEngine value, for consistency check
}

export interface CashLadderOptions {
  projectionDays: number; // default 60, max 365
  includeProjectedYield: boolean; // default true for daily chart; schedule always excludes yield
  maxOccurrencesPerObligation: number; // default 1000 (expansion cap)
}

export type OccurrenceState = 'OVERDUE' | 'IN_WINDOW' | 'SCHEDULED';

export interface OccurrenceProjection {
  obligationId: bigint;
  occurrenceIndex: number; // 1-based overall index (paidOccurrences + k)
  dueDate: UnixSeconds;
  withdrawalDeadline: UnixSeconds;
  amount: Amount;
  category: Category;
  recipient: Address;
  state: OccurrenceState;
}

export type WithdrawalItemState = 'DUE_NOW' | 'UPCOMING' | 'SATISFIED_BY_IDLE';

export interface WithdrawalScheduleItem {
  deadline: UnixSeconds; // time at which funds must be idle
  amount: Amount; // incremental amount to bring back at this deadline
  requiredReserveAfter: Amount;
  covers: { obligationId: bigint; occurrenceIndex: number; dueDate: UnixSeconds; amount: Amount }[];
  suggestedSources: { adapter: Address; amount: Amount }[];
  state: WithdrawalItemState;
}

export interface DailyLiquidityPoint {
  dayIndex: number; // 0 = today (chain time)
  date: UnixSeconds; // start of that projected day (chainTime + dayIndex*86400)
  requiredReserve: Amount;
  projectedIdle: Amount;
  projectedVault: Amount;
  projectedTotal: Amount;
  paymentsToday: Amount;
  withdrawalsToday: Amount;
  projectedYieldCumulative: Amount;
  deficit: Amount; // > 0 means obligations exceed total assets
}

export type LadderWarningCode =
  | 'UNDERFUNDED' // total assets < required reserve now
  | 'FUTURE_INSOLVENCY' // a future obligation cannot be funded from total assets
  | 'SHORTFALL_NOW' // idle < required now (deadline passed, funds still invested)
  | 'OVERDUE_OBLIGATION'
  | 'LIQUIDITY_RISK' // upcoming withdrawal > available pool liquidity
  | 'CIRCUIT_BREAKER_ACTIVE'
  | 'ONCHAIN_MISMATCH'; // engine reserve != PolicyEngine reserve

export interface LadderWarning {
  code: LadderWarningCode;
  message: string;
  amount?: Amount;
  at?: UnixSeconds;
}

export interface CashLadderResult {
  snapshotId: string;
  asOf: UnixSeconds;
  totalAssets: Amount;
  idle: Amount;
  vaultTotal: Amount;
  requiredReserve: Amount;
  investableCapital: Amount;
  investableNow: { adapter: Address; amount: Amount }[];
  capitalEfficiencyBps: Bps;
  actualEfficiencyBps: Bps;
  shortfall: Amount;
  occurrences: OccurrenceProjection[];
  withdrawalSchedule: WithdrawalScheduleItem[];
  daily: DailyLiquidityPoint[];
  warnings: LadderWarning[];
}
