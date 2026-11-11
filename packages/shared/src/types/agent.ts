// docs/05 §5.3 (decision interfaces), §5.1 (AgentSettings), §2.1 (DecisionStatus), §8 (AgentMode).
// `decide()` itself is implemented in agent/src/engines.
import type { Address, Amount, Category, UnixSeconds } from './ladder';
import type { AgentActionStatus } from './entities';

export type AgentActionType = 'INVEST' | 'WITHDRAW' | 'WITHDRAW_ALL' | 'TRIP_CIRCUIT_BREAKER' | 'HOLD';
export type ReasonCode =
  | 'DEADLINE_REACHED'
  | 'POOL_RISK_CRITICAL'
  | 'ALL_POOLS_CRITICAL'
  | 'APY_BELOW_MINIMUM'
  | 'PRE_DEADLINE'
  | 'POOL_RISK_WATCH'
  | 'IDLE_SURPLUS'
  | 'MANUAL'; // ADMIN-initiated via POST /vault/withdrawals or /vault/investments (07 §5.5)

export interface AgentDecisionDraft {
  action: AgentActionType;
  adapter: Address | null;
  amount: Amount | null; // null for breaker/hold; maxUint256 never used (explicit amounts)
  reasonCode: ReasonCode;
  facts: DecisionFacts;
  snapshotId: string;
}

export interface DecisionFacts {
  // the ONLY numbers the explainer may use
  chainTime: UnixSeconds;
  idle: string;
  vaultTotal: string;
  totalAssets: string; // decimal strings, e.g. "70000.00"
  requiredReserve: string;
  investableNow: string;
  shortfall: string;
  amount: string | null;
  adapterName: string | null;
  apyPercent: string | null; // "1.00"
  previousApyPercent: string | null;
  riskScore: number | null;
  utilizationPercent: string | null;
  paused: boolean | null;
  nextObligation: { label: string; category: Category; amount: string; dueInDays: number } | null;
  deadlineInDays: number | null;
  safetyHorizonDays: number;
  mode: 'APPROVE' | 'AUTO';
}

export type AgentMode = 'APPROVE' | 'AUTO';

export type DecisionStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'BLOCKED_BY_POLICY'
  | 'FAILED';

/** docs/05 §5.1 — editable by ADMIN in the Settings page. */
export interface AgentSettings {
  mode: AgentMode;
  minApyBps: number;
  riskInvestThreshold: number;
  riskWithdrawThreshold: number;
  minActionAmount: Amount;
  preWithdrawLeadDays: number;
  decisionTtlSec: number;
  loopIntervalSec: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  mode: 'APPROVE',
  minApyBps: 300,
  riskInvestThreshold: 70,
  riskWithdrawThreshold: 40,
  minActionAmount: 100_000_000n, // 100 USDC
  preWithdrawLeadDays: 2,
  decisionTtlSec: 600,
  loopIntervalSec: 30,
};

// ---- API shapes for the approve flow (docs/07 §4.7) -----------------------------------------------------------

export type ExplanationSource = 'LLM' | 'TEMPLATE';

/** docs/05 §7.1 explainer output (+ `source`, docs/07 §4.7). */
export interface Explanation {
  headline: string;
  explanation: string;
  reasons: string[];
  riskNote: string | null;
  source: ExplanationSource;
}

/** `AgentAction` row as returned inside `AgentDecisionJson.actions` (docs/09 §3). */
export interface AgentActionJson {
  id: string;
  decisionId: string;
  functionName: 'invest' | 'withdraw' | 'tripCircuitBreaker';
  args: unknown[]; // JSON-safe (bigint → string)
  status: AgentActionStatus;
  txHash: string | null;
  snowtraceUrl: string | null;
  decodedError: { name: string; args: Record<string, unknown> } | null;
  gasUsed: string | null;
  blockNumber: string | null;
  attempt: number;
  createdAt: UnixSeconds;
  updatedAt: UnixSeconds;
}

/**
 * `AgentDecision` JSON (docs/07 §4.7). `amount` is a base-unit string. `createdAt` / `expiresAt` are Unix seconds of
 * the server wall clock (approval TTL is operational; chain time is `facts.chainTime`).
 */
export interface AgentDecisionJson {
  id: string;
  action: AgentActionType;
  adapter: Address | null;
  amount: string | null;
  reasonCode: ReasonCode;
  status: DecisionStatus;
  mode: AgentMode;
  explanation: Explanation | null;
  facts: DecisionFacts;
  snapshotId: string;
  approvedBy: Address | null;
  approvedAt: UnixSeconds | null;
  rejectedBy: Address | null;
  rejectReason: string | null;
  createdAt: UnixSeconds;
  expiresAt: UnixSeconds;
  updatedAt: UnixSeconds;
  actions: AgentActionJson[];
}

/** `GET /keeper/status` (docs/07 §4.7). */
export interface KeeperStatusJson {
  enabled: boolean;
  keeperAddress: Address | null;
  avaxBalance: string | null; // wei, decimal string
  intervalSec: number;
  lastRunAt: UnixSeconds | null;
  nextRunAt: UnixSeconds | null;
  lastResult: {
    id: string;
    chainTime: UnixSeconds;
    shortfallBefore: string;
    enforced: boolean;
    paidIds: string[];
    txHashes: string[];
    errors: { step: string; obligationId?: string; error: { name: string; args: Record<string, unknown> } | string }[];
  } | null;
  lastError: string | null;
}
