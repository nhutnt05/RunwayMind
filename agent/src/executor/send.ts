// Simulate → send → confirm primitives shared by the executor (AGENT key) and the keeper (KEEPER key), docs/05 §10.
import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from 'viem';
import { redactUrls } from '../audit/audit';
import { decodeContractError, type DecodedError } from '../chain/errors';
import type { NonceQueue } from './nonceQueue';

/** Simulation reverts with these errors are policy blocks (docs/05 §10 step 2) → BLOCKED_BY_POLICY. */
export const POLICY_ERRORS: ReadonlySet<string> = new Set([
  'ReserveViolation',
  'ExposureLimitExceeded',
  'AdapterNotWhitelisted',
  'CircuitBreakerActive',
  'InsufficientIdle',
]);

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000];
export const DEFAULT_RECEIPT_TIMEOUT_MS = 60_000;

export type AgentWallet = WalletClient<Transport, Chain, Account>;

export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/** A contract revert (as opposed to a network / nonce failure). Reverts are never retried. */
export function isRevertError(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  if (e.walk((x) => x instanceof ContractFunctionRevertedError)) return true;
  return decodeContractError(e) !== null || /execution reverted|reverted/i.test(e.shortMessage ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries `fn` after each delay while `retryable(error)`; rethrows the last error. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  delays: readonly number[],
  retryable: (e: unknown) => boolean = (e) => !isRevertError(e),
  onRetry?: (e: unknown, attempt: number) => void,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (e) {
      const delay = delays[attempt - 1];
      if (delay === undefined || !retryable(e)) throw e;
      onRetry?.(e, attempt);
      await sleep(delay);
    }
  }
}

export type SimulationOutcome =
  | { ok: true }
  | { ok: false; reverted: true; error: DecodedError | null; message: string }
  | { ok: false; reverted: false; error: null; message: string };

/** Error text for audit rows / KeeperRun errors (served publicly): RPC URLs (API keys) are redacted (rule 7). */
export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) return redactUrls(e.shortMessage || e.message);
  return redactUrls(e instanceof Error ? e.message : String(e));
}

/** `simulateContract` from `account`; network failures are retried, reverts are decoded. */
export async function simulateCall(
  client: PublicClient,
  account: Address | Account,
  call: ContractCall,
  delays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<SimulationOutcome> {
  try {
    await withRetry(() => client.simulateContract({ account, ...call } as never), delays);
    return { ok: true };
  } catch (e) {
    if (isRevertError(e)) return { ok: false, reverted: true, error: decodeContractError(e), message: errorMessage(e) };
    return { ok: false, reverted: false, error: null, message: errorMessage(e) };
  }
}

export class SendRevertedError extends Error {
  constructor(
    readonly decoded: DecodedError | null,
    message: string,
  ) {
    super(message);
    this.name = 'SendRevertedError';
  }
}

/**
 * An earlier attempt may already be in the mempool / mined (its response was lost), and the node now reports the
 * nonce as used. Re-sending with a fresh nonce could execute the call twice, so the send is abandoned instead; the
 * event indexer records the transaction if it was mined.
 */
export class SendAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SendAmbiguousError';
  }
}

/** The node already has a transaction at this nonce (ours from a lost response, or another sender's). */
export function isNonceConsumed(e: unknown): boolean {
  if (e instanceof BaseError && e.walk((x) => (x as Error).name === 'NonceTooLowError') !== null) return true;
  const text = e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ''}` : e instanceof Error ? e.message : String(e);
  return /nonce too low|already known|replacement transaction underpriced|nonce has already been used/i.test(text);
}

export interface SendOptions {
  client: PublicClient;
  wallet: AgentWallet;
  queue: NonceQueue;
  call: ContractCall;
  delays?: readonly number[];
  receiptTimeoutMs?: number;
  onSent?: (hash: Hex, attempt: number) => Promise<void> | void;
}

/**
 * Sends with a locally-managed nonce (call inside `queue.run`), retrying network / nonce errors with backoff, then
 * waits for 1 confirmation. Returns the receipt even if it reverted (`receipt.status === 'reverted'`, not retried).
 * Throws `SendRevertedError` when the node rejects the call as a revert at gas estimation.
 */
export async function sendAndConfirm(o: SendOptions): Promise<{ hash: Hex; receipt: TransactionReceipt; attempts: number }> {
  const delays = o.delays ?? DEFAULT_RETRY_DELAYS_MS;
  let attempts = 0;
  // Network / timeout failures are retried with the SAME nonce: the request may have reached the node even though
  // the response was lost, and one nonce can be mined at most once — so a retry can never execute the call twice.
  let nonce: number | null = null;
  let maybeSent = false;
  let hash: Hex;
  try {
    hash = await withRetry(
      async (attempt) => {
        attempts = attempt;
        nonce ??= await o.queue.next();
        try {
          return await o.wallet.writeContract({ ...o.call, nonce } as never);
        } catch (e) {
          if (isRevertError(e)) throw new SendRevertedError(decodeContractError(e), errorMessage(e));
          if (isNonceConsumed(e)) {
            if (maybeSent) throw new SendAmbiguousError(`nonce ${nonce} already used after a lost send response; not re-sent: ${errorMessage(e)}`);
            o.queue.reset(); // another sender took this nonce → resync from the node and send with the next one
            nonce = null;
          } else {
            maybeSent = true;
          }
          throw e;
        }
      },
      delays,
      (e) => !(e instanceof SendRevertedError) && !(e instanceof SendAmbiguousError),
    );
  } catch (e) {
    o.queue.reset(); // the reserved nonce was not (knowingly) used → resync from the node for the next send
    throw e;
  }
  await o.onSent?.(hash, attempts);
  const receipt = await withRetry(
    () => o.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: o.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS }),
    delays,
    () => true,
  );
  return { hash, receipt, attempts };
}
