// Verbatim from docs/09 §2 (additional off-chain entities).
import type { Address, Amount, Category, OccurrenceProjection, UnixSeconds } from './ladder';

export interface TreasuryConfig {
  // "Treasury" entity
  id: string; // 'fuji-musdc' | 'fuji-usdc'
  chainId: 43113;
  treasuryAddress: Address;
  registryAddress: Address;
  policyAddress: Address;
  assetAddress: Address;
  assetSymbol: string;
  assetDecimals: number;
  deployBlock: bigint;
  demoStartTime: UnixSeconds | null; // T0 for "Day N" labels
  isPrimary: boolean;
}

export type WalletRole = 'ADMIN' | 'AGENT' | 'KEEPER' | 'VIEWER';
export interface Wallet {
  address: Address;
  label: string | null;
  lastSeenAt: UnixSeconds;
  cachedRoles: WalletRole[];
  rolesCheckedAt: UnixSeconds;
}

export type ObligationSource = 'FORM' | 'NL' | 'SEED';
export interface ObligationMetadata {
  treasuryId: string;
  obligationId: bigint;
  label: string;
  notes: string | null;
  source: ObligationSource;
  nlDraftId: string | null;
  metadataHash: `0x${string}`;
  createTxHash: `0x${string}`;
}

export type DraftStatus = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'DISCARDED';
export interface ObligationDraft {
  id: string;
  treasuryId: string;
  status: DraftStatus;
  source: ObligationSource;
  label: string;
  category: Category;
  recipient: Address | null;
  amount: Amount;
  firstDueDate: UnixSeconds;
  interval: number;
  maxOccurrences: number;
  warnings: string[];
  sourceText: string | null;
  createdBy: Address;
  createdAt: UnixSeconds;
}

export interface RecurringObligationView {
  // "Recurring Obligation" (derived, not stored)
  obligationId: bigint;
  interval: number;
  maxOccurrences: number;
  paidOccurrences: number;
  nextDueDate: UnixSeconds;
  upcoming: OccurrenceProjection[];
}

export interface Pool {
  adapterAddress: Address;
  poolAddress: Address;
  treasuryId: string;
  name: string;
  kind: 'MOCK' | 'AAVE_V3';
  addedAt: UnixSeconds;
}

export interface PoolMetricSample {
  adapterAddress: Address;
  sampledAt: UnixSeconds;
  blockNumber: bigint;
  apyBps: number;
  utilizationBps: number;
  tvl: Amount;
  availableLiquidity: Amount;
  paused: boolean;
}

export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'FAILED' | 'DROPPED';
export type TransactionKind =
  | 'CREATE_OBLIGATION'
  | 'UPDATE_OBLIGATION'
  | 'CANCEL_OBLIGATION'
  | 'INVEST'
  | 'WITHDRAW'
  | 'PAY'
  | 'ENFORCE_DEADLINES'
  | 'TRIP_BREAKER'
  | 'RESET_BREAKER'
  | 'SET_POLICY'
  | 'SET_ADAPTER_STATUS'
  | 'ADVANCE_TIME'
  | 'POOL_CONTROL'
  | 'OTHER';

export type AgentActionStatus = 'SIMULATING' | 'BLOCKED_BY_POLICY' | 'SENT' | 'CONFIRMED' | 'REVERTED' | 'FAILED';

export type AuditEventType =
  | 'AGENT_TICK'
  | 'DECISION_CREATED'
  | 'DECISION_APPROVED'
  | 'DECISION_REJECTED'
  | 'DECISION_EXPIRED'
  | 'DECISION_SUPERSEDED'
  | 'ACTION_SIMULATION_REVERTED'
  | 'ACTION_SENT'
  | 'ACTION_CONFIRMED'
  | 'ACTION_FAILED'
  | 'KEEPER_PAY'
  | 'KEEPER_ENFORCE'
  | 'MODE_CHANGED'
  | 'SETTINGS_CHANGED'
  | 'NL_PARSE'
  | 'ENGINE_MISMATCH'
  | 'LLM_FALLBACK'
  | 'LOGIN'
  | 'INFLOW_CHANGED';

/** Obligation `derivedState` returned by the API (docs/07 §4.2, docs/09 §5). */
export type ObligationDerivedState = 'SCHEDULED' | 'IN_WINDOW' | 'DUE' | 'OVERDUE' | 'PAID' | 'CANCELLED';
