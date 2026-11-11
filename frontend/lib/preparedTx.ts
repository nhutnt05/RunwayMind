// Guards for backend-prepared ADMIN transactions (docs/07 §5, docs/08 §6). The backend never holds the ADMIN key; it
// returns calldata that the wallet signs. Before handing it to the wallet we decode it against the shared registry ABI
// and refuse anything that is not one of the expected registry calls on the expected chain — so a compromised or buggy
// backend cannot make the admin sign an arbitrary call.
import { BaseError, ContractFunctionRevertedError, decodeFunctionData, isAddressEqual, type Address } from 'viem';
import { formatUsdc } from '@runwaymind/shared';
import { obligationRegistryAbi } from '@runwaymind/shared/abi';
import type { DecodedContractError, PreparedTx } from './api';

export const REGISTRY_WRITE_FUNCTIONS = ['createObligation', 'updateObligation', 'cancelObligation'] as const;
export type RegistryWriteFunction = (typeof REGISTRY_WRITE_FUNCTIONS)[number];

export interface VerifiedRegistryCall {
  address: Address;
  functionName: RegistryWriteFunction;
  args: readonly unknown[];
}

export function verifyRegistryTx(
  tx: PreparedTx,
  expected: { registry: Address; chainId: number; functionName: RegistryWriteFunction },
): VerifiedRegistryCall {
  if (tx.chainId !== expected.chainId) throw new Error(`Prepared tx targets chain ${tx.chainId}, expected ${expected.chainId}`);
  if (!isAddressEqual(tx.to, expected.registry)) throw new Error('Prepared tx is not addressed to the ObligationRegistry');
  if (tx.value !== '0') throw new Error('Prepared tx must not transfer native value');
  const decoded = decodeFunctionData({ abi: obligationRegistryAbi, data: tx.data });
  if (decoded.functionName !== expected.functionName || tx.functionName !== expected.functionName) {
    throw new Error(`Prepared tx calls ${decoded.functionName}, expected ${expected.functionName}`);
  }
  return { address: expected.registry, functionName: expected.functionName, args: (decoded.args ?? []) as readonly unknown[] };
}

const AMOUNT_ARGS = new Set(['idleAfter', 'requiredReserve', 'amount', 'available', 'requested', 'cap', 'exposureAfter']);

function formatArg(key: string, value: unknown): string {
  if (AMOUNT_ARGS.has(key) && (typeof value === 'string' || typeof value === 'bigint') && /^\d+$/.test(String(value))) {
    return formatUsdc(BigInt(value));
  }
  return String(value);
}

/**
 * Human text for a decoded custom error (docs/08 §8), e.g.
 * `ReserveViolation: idle after 10,000.00 < required 30,000.00`.
 */
export function formatDecodedError(err: DecodedContractError | null | undefined): string {
  if (!err) return 'Transaction would revert';
  const args = err.args as Record<string, unknown>;
  if (err.name === 'ReserveViolation' && args && 'idleAfter' in args && 'requiredReserve' in args) {
    return `ReserveViolation: idle after ${formatArg('idleAfter', args.idleAfter)} < required ${formatArg('requiredReserve', args.requiredReserve)}`;
  }
  const entries = Array.isArray(err.args)
    ? err.args.map((v, i) => `${i}=${String(v)}`)
    : Object.entries(err.args ?? {}).map(([k, v]) => `${k}=${formatArg(k, v)}`);
  return entries.length ? `${err.name}: ${entries.join(', ')}` : err.name;
}

/** Best-effort message for wallet / simulation errors, preferring the decoded custom error name. */
export function describeWriteError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      const values = revert.data.args ?? [];
      const inputs = (revert.data.abiItem as { inputs?: readonly { name?: string }[] }).inputs ?? [];
      const args = Object.fromEntries(values.map((v, i) => [inputs[i]?.name || String(i), v]));
      return formatDecodedError({ name: revert.data.errorName, args });
    }
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
