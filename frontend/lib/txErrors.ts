// Plain-language classification of a failed write (the message produced by describeStageError in lib/preparedTx.ts,
// e.g. "Wallet / wallet RPC: User rejected the request."). Used by transaction dialogs to explain what happened
// and whether retrying makes sense. Classification is text-based because wallets and RPCs word errors differently.

export type TxFailureKind = 'USER_REJECTED' | 'INSUFFICIENT_FUNDS' | 'REVERTED' | 'NETWORK' | 'UNKNOWN';

export interface TxFailure {
  kind: TxFailureKind;
  title: string;
  /** What it means for the user, and what to do next. */
  help: string;
  /** Retrying the same action can reasonably succeed (false when the contract itself rejects it). */
  retryable: boolean;
  /** The underlying message (already URL-redacted), shown as technical detail. */
  detail: string;
}

const RULES: { kind: TxFailureKind; re: RegExp }[] = [
  { kind: 'USER_REJECTED', re: /user (rejected|denied|cancel+ed)|rejected the request|request (was )?rejected|denied transaction|action_rejected|\b4001\b/i },
  { kind: 'INSUFFICIENT_FUNDS', re: /insufficient funds|insufficient balance for gas|gas required exceeds|exceeds the balance|not enough (avax|funds)/i },
  {
    kind: 'REVERTED',
    re: /revert|would revert|execution reverted|ObligationNotActive|UnknownObligation|AccessControl|custom error|ReserveViolation/i,
  },
  { kind: 'NETWORK', re: /network|fetch failed|failed to fetch|timeout|timed out|HTTP|rate limit|429|ECONN|socket|RPC|unavailable|disconnected/i },
];

const COPY: Record<TxFailureKind, Omit<TxFailure, 'kind' | 'detail'>> = {
  USER_REJECTED: {
    title: 'Transaction rejected in wallet',
    help: 'You declined the request in your wallet. Nothing was sent to the network and the obligation is unchanged.',
    retryable: true,
  },
  INSUFFICIENT_FUNDS: {
    title: 'Insufficient gas',
    help: 'The connected wallet does not hold enough AVAX to pay the network fee. Top it up, then try again.',
    retryable: true,
  },
  REVERTED: {
    title: 'Transaction reverted',
    help: 'The contract rejected this cancellation, so the obligation is unchanged. It may already be paid or cancelled, or your wallet may lack the ADMIN role.',
    retryable: false,
  },
  NETWORK: {
    title: 'Network error',
    help: 'The app could not reach the network or the backend. Check your connection and RPC, then try again.',
    retryable: true,
  },
  UNKNOWN: {
    title: 'Cancellation failed',
    help: 'The cancellation did not complete. Review the details below before trying again.',
    retryable: true,
  },
};

/** Stage prefixes added by describeStageError ("Wallet / wallet RPC: …"): their own words (e.g. "RPC") must not classify. */
const STAGE_PREFIX = /^(Backend prepare|Simulation \(app RPC\)|Wallet \/ wallet RPC|Waiting for receipt): /;

export function classifyTxError(message: string): TxFailure {
  const body = message.replace(STAGE_PREFIX, '');
  const kind = RULES.find((r) => r.re.test(body))?.kind ?? 'UNKNOWN';
  return { kind, ...COPY[kind], detail: message };
}
