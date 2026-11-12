// Typed backend client (docs/08 §6): parses the envelope (docs/07 §2.1) and throws ApiError on failure.
// Request bodies are validated with the shared zod schemas before sending.
import type { z } from 'zod';
import type {
  AgentActionStatus,
  AgentActionType,
  AgentMode,
  Address,
  ApiEnvelope,
  ApiErrorCode,
  ApiMeta,
  CashLadderResult,
  Category,
  DecisionStatus,
  JsonSafe,
  ObligationDerivedState,
  ObligationSource,
  ReasonCode,
  RiskClass,
  TransactionKind,
  TransactionStatus,
  WithdrawalScheduleItem,
} from '@runwaymind/shared';
import { publicEnv } from './env';
import { getSelectedTreasuryId, withTreasuryParam } from './treasurySelection';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

type Fetch = typeof fetch;

export function parseEnvelope<T>(status: number, body: unknown): ApiResult<T> {
  const env = body as ApiEnvelope<T> | null;
  if (!env || typeof env !== 'object' || !('success' in env)) {
    throw new ApiError('INTERNAL_ERROR', `Unexpected response (HTTP ${status})`, status);
  }
  if (!env.success) throw new ApiError(env.error.code, env.error.message, status, env.error.details);
  return { data: env.data, meta: env.meta };
}

export function createApiClient(baseUrl: string = publicEnv.apiBaseUrl, fetchImpl: Fetch = (...a) => fetch(...a)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    let res: Response;
    try {
      // D6 multi-treasury: every request targets the selected treasury (backend default = primary).
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${withTreasuryParam(path, getSelectedTreasuryId())}`, {
        method,
        credentials: 'include', // rm_session cookie (SIWE)
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError('NETWORK_ERROR', (e as Error).message || 'Network error', 0);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return parseEnvelope<T>(res.status, json);
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    delete: <T>(path: string) => request<T>('DELETE', path),
    /** POST with a body validated by a shared zod schema (throws ZodError before any network call). */
    postValidated: <S extends z.ZodTypeAny, T>(path: string, schema: S, body: z.input<S>) =>
      request<T>('POST', path, schema.parse(body)),
    /** PATCH with a body validated by a shared zod schema. */
    patchValidated: <S extends z.ZodTypeAny, T>(path: string, schema: S, body: z.input<S>) =>
      request<T>('PATCH', path, schema.parse(body)),
    /** PUT with a body validated by a shared zod schema. */
    putValidated: <S extends z.ZodTypeAny, T>(path: string, schema: S, body: z.input<S>) =>
      request<T>('PUT', path, schema.parse(body)),
  };
}

export const api = createApiClient();

// ---- response shapes (docs/07 §4; bigint → string) --------------------------------------------------------------

export interface TreasuryOverview {
  treasury: Address;
  asset: { address: Address; symbol: string; decimals: number };
  chainTime: number;
  demoMode: boolean;
  demoStartTime: number | null;
  timeOffset: number;
  circuitBreakerActive: boolean;
  idle: string;
  vaultTotal: string;
  totalAssets: string;
  requiredReserve: string;
  shortfall: string;
  investableCapital: string;
  capitalEfficiencyBps: number;
  actualEfficiencyBps: number;
  accruedYield: string | null;
  runway: { runwayDays: number; capped: boolean; classification: RiskClass };
  policy: { safetyHorizonSec: number; emergencyBuffer: string; maxExposureBps: number };
  adapters: {
    address: Address;
    name: string;
    status: string;
    balance: string;
    apyBps: number;
    paused: boolean;
    utilizationBps: number;
    riskScore: number;
  }[];
  nextObligation: { id: string; label: string | null; amount: string; dueDate: number } | null;
  pendingRecommendations: number;
}

export interface ObligationItem {
  id: string;
  recipient: Address;
  amount: string;
  nextDueDate: number;
  interval: number;
  maxOccurrences: number;
  paidOccurrences: number;
  category: Category;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  withdrawalDeadline: number;
  derivedState: ObligationDerivedState;
  metadata: { label: string; notes: string | null; source: ObligationSource } | null;
}

export type WithdrawalScheduleJson = { items: JsonSafe<WithdrawalScheduleItem>[] };
export type CashLadderJson = JsonSafe<CashLadderResult>;

// ---- write endpoints (docs/07 §5.1–§5.3) -------------------------------------------------------------------------
// TODO(shared): PreparedTx / PrepareTxResponse should move to @runwaymind/shared (types/api.ts) so backend and
// frontend share one definition.

export interface DecodedContractError {
  name: string;
  args: Record<string, unknown> | unknown[];
}

export interface PreparedTx {
  to: Address;
  data: `0x${string}`;
  value: string; // wei, decimal string
  chainId: number;
  functionName: string;
}

/** Response of POST /obligations, PATCH /obligations/:id, POST /obligations/:id/cancel. */
export interface PrepareTxResponse {
  draftId?: string | null;
  metadataHash?: `0x${string}` | null;
  preparedTx: PreparedTx | null; // null for label/notes-only PATCH (applied directly to DB)
  simulation: { ok: boolean; error: DecodedContractError | null } | null;
}

// ---- recommendations (docs/07 §4.7) ------------------------------------------------------------------------------
// TODO(shared): Explanation / AgentDecisionJson / AgentActionJson should move to @runwaymind/shared.

export interface ExplanationJson {
  headline: string;
  explanation: string;
  reasons: string[];
  riskNote: string | null;
  source: 'LLM' | 'TEMPLATE';
}

/** AgentAction JSON (shape inferred from docs/09 AgentAction model; docs/07 only shows `"actions": []`). */
export interface AgentActionJson {
  id: string;
  functionName: string;
  status: AgentActionStatus;
  txHash: `0x${string}` | null;
  decodedError: DecodedContractError | null;
  blockNumber?: string | null;
  createdAt?: number;
}

export interface AgentDecisionJson {
  id: string;
  action: AgentActionType;
  adapter: Address | null;
  amount: string | null;
  reasonCode: ReasonCode;
  status: DecisionStatus;
  mode: AgentMode;
  explanation: ExplanationJson | null;
  facts: Record<string, unknown>;
  snapshotId: string;
  createdAt: number;
  expiresAt: number;
  actions: AgentActionJson[];
}

// ---- transactions (docs/07 §4.8) ---------------------------------------------------------------------------------
// TODO(shared): TransactionJson should move to @runwaymind/shared.
export interface TransactionJson {
  hash: `0x${string}`;
  kind: TransactionKind;
  from: Address;
  status: TransactionStatus;
  blockNumber: string | null;
  decodedEvents: { name: string; args: Record<string, unknown> }[];
  error: DecodedContractError | null;
  snowtraceUrl: string;
  createdAt: number;
}

// ---- D4: agent settings / activity / keeper, vault + policy/demo prepared txs (docs/07 §4.7, §5.5–§5.7) ----------

export interface AgentSettingsJson {
  mode: AgentMode;
  minApyBps: number;
  riskWithdrawThreshold: number;
  riskInvestThreshold: number;
  preWithdrawLeadDays: number;
  minActionAmount: string;
  loopIntervalSec: number;
  decisionTtlSec: number;
}

export interface KeeperRunJson {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  chainTime: number;
  shortfallBefore: string;
  enforced: boolean;
  paidIds: string[];
  txHashes: string[];
  errors: unknown[];
}

export interface KeeperStatusJson {
  enabled: boolean;
  keeperAddress: Address | null;
  avaxBalance: string | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastResult: KeeperRunJson | null;
  lastError: string | null;
}

/** POST /vault/withdrawals | /vault/investments. */
export interface VaultActionResponse {
  executeVia: 'AGENT' | 'ADMIN_WALLET';
  decision: AgentDecisionJson | null;
  preparedTx: PreparedTx | null;
  simulation: { ok: boolean; error: DecodedContractError | null };
}

/** POST /policy/prepare | /demo/prepare. */
export interface AdminPrepareResponse {
  preparedTx: PreparedTx & { contract: 'Treasury' | 'PolicyEngine' | 'MockLendingPool' };
  simulation: { ok: boolean; error: DecodedContractError | null };
}

/** GET /transactions item (backend adds initiator / relatedId / confirmedAt). */
export type TransactionItemJson = TransactionJson & {
  initiator?: 'AGENT' | 'KEEPER' | 'ADMIN_UI' | 'INDEXER';
  relatedId?: string | null;
  confirmedAt?: number | null;
};
