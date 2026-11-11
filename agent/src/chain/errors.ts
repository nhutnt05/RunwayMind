// Custom-error decoding across every contract ABI (docs/07 §6) → { name, args }.
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi, type Hex } from 'viem';
import {
  mockLendingPoolAbi,
  mockUSDCAbi,
  obligationRegistryAbi,
  policyEngineAbi,
  treasuryAbi,
  vaultAdapterAbi,
} from '@runwaymind/shared/abi';
import { toJsonSafe } from '@runwaymind/shared';

export interface DecodedError {
  name: string;
  args: Record<string, unknown>;
}

type AbiErrorItem = { type: 'error'; name: string; inputs: readonly { name: string; type: string }[] };

/** Every `error` item from all contract ABIs, de-duplicated by signature. */
export const ALL_ERRORS_ABI: Abi = (() => {
  const seen = new Map<string, AbiErrorItem>();
  const abis = [treasuryAbi, obligationRegistryAbi, policyEngineAbi, vaultAdapterAbi, mockLendingPoolAbi, mockUSDCAbi];
  for (const abi of abis) {
    for (const item of abi as readonly { type: string }[]) {
      if (item.type !== 'error') continue;
      const e = item as AbiErrorItem;
      const sig = `${e.name}(${e.inputs.map((i) => i.type).join(',')})`;
      if (!seen.has(sig)) seen.set(sig, e);
    }
  }
  return [...seen.values()] as unknown as Abi;
})();

function namedArgs(name: string, args: readonly unknown[] | undefined): Record<string, unknown> {
  const item = (ALL_ERRORS_ABI as readonly AbiErrorItem[]).find((e) => e.name === name);
  const out: Record<string, unknown> = {};
  (args ?? []).forEach((value, i) => {
    out[item?.inputs[i]?.name || `arg${i}`] = value;
  });
  return toJsonSafe(out) as Record<string, unknown>;
}

/** Decodes raw revert data (`0x` + selector + args). Returns null for unknown selectors. */
export function decodeRevertData(data: Hex): DecodedError | null {
  try {
    const { errorName, args } = decodeErrorResult({ abi: ALL_ERRORS_ABI, data });
    return { name: errorName, args: namedArgs(errorName, args) };
  } catch {
    return null;
  }
}

/** Extracts and decodes a custom error from any viem error (simulate / write / call). */
export function decodeContractError(err: unknown): DecodedError | null {
  if (!(err instanceof BaseError)) return null;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    if (reverted.data?.errorName) {
      return { name: reverted.data.errorName, args: namedArgs(reverted.data.errorName, reverted.data.args) };
    }
    if (reverted.raw) return decodeRevertData(reverted.raw);
  }
  const withData = err.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null;
  return withData?.data ? decodeRevertData(withData.data) : null;
}

/** Policy rule each decoded error maps to (UI: "Blocked by R1 Reserve Ratio …", docs/08 §3.8). */
export const POLICY_RULE_BY_ERROR: Readonly<Record<string, string>> = {
  ReserveViolation: 'R1 Reserve Ratio',
  ExposureLimitExceeded: 'R3 Exposure Limit',
  AdapterNotWhitelisted: 'R4 Whitelist',
  CircuitBreakerActive: 'R6 Circuit Breaker',
};
