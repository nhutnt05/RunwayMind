// docs/07 §2.1 (envelope) and §2.4 (error codes).
import type { AuditEventType, TransactionKind, TransactionStatus } from './entities';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_NOT_ADMIN'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'POLICY_VIOLATION'
  | 'NL_PARSE_FAILED'
  | 'RATE_LIMITED'
  | 'CHAIN_UNAVAILABLE'
  | 'LLM_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export const API_ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN_NOT_ADMIN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  POLICY_VIOLATION: 409,
  NL_PARSE_FAILED: 422,
  RATE_LIMITED: 429,
  CHAIN_UNAVAILABLE: 502,
  LLM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorDetail {
  path?: string;
  issue?: string;
  [key: string]: unknown;
}

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[] | Record<string, unknown>;
}

export interface ApiMeta {
  requestId: string;
  chainTime?: number; // Unix seconds, chain time
  blockNumber?: string; // bigint as decimal string
  nextCursor?: string | null; // §2.3 pagination
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  data: null;
  error: ApiError;
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

// ---- docs/07 §4.8 transactions / audit, §5 prepared transactions ----------------------------------------------

export interface DecodedEventJson {
  name: string;
  args: Record<string, unknown>; // bigint → decimal string
  address?: string;
  logIndex?: number;
}

/** `Transaction` JSON (docs/07 §4.8). */
export interface TransactionJson {
  hash: string;
  kind: TransactionKind;
  from: string;
  initiator: 'AGENT' | 'KEEPER' | 'ADMIN_UI' | 'INDEXER';
  status: TransactionStatus;
  blockNumber: string | null;
  decodedEvents: DecodedEventJson[];
  error: unknown;
  relatedId: string | null;
  snowtraceUrl: string;
  createdAt: number; // Unix seconds (server clock)
  confirmedAt: number | null;
}

export interface AuditLogJson {
  id: number;
  eventType: AuditEventType;
  actor: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  createdAt: number; // Unix seconds (server clock)
}

/** Calldata for the ADMIN wallet to sign (docs/07 §5). */
export interface PreparedTxJson {
  to: string;
  data: string;
  value: string;
  chainId: number;
  functionName: string;
}

export interface SimulationJson {
  ok: boolean;
  error: { name: string; args: Record<string, unknown> } | { name: 'UNKNOWN'; message: string } | null;
}

/** Response of POST /obligations, PATCH /obligations/:id, POST /obligations/:id/cancel (docs/07 §5.1–§5.3). */
export interface PrepareObligationResponse {
  draftId: string | null;
  metadataHash: string | null;
  preparedTx: PreparedTxJson | null;
  simulation: SimulationJson | null;
}
