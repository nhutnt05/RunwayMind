// Guard for backend-prepared ADMIN transactions on Treasury / PolicyEngine / MockLendingPool (docs/07 §5.5–§5.7,
// docs/08 §6). Same idea as verifyRegistryTx: decode the calldata with the shared ABI and refuse anything that is not
// an expected function on the expected contract and chain, so a compromised backend cannot make the admin sign an
// arbitrary call (e.g. a transfer).
import { decodeFunctionData, isAddressEqual, type Abi, type Address } from 'viem';
import type { TransactionKind } from '@runwaymind/shared';
import { mockLendingPoolAbi, policyEngineAbi, treasuryAbi } from '@runwaymind/shared/abi';
import type { PreparedTx } from './api';

export type AdminContract = 'Treasury' | 'PolicyEngine' | 'MockLendingPool';

/** Every ADMIN-signed call the UI may send, with the TransactionKind it is registered under (POST /transactions). */
export const ADMIN_FUNCTIONS = {
  Treasury: {
    invest: 'INVEST',
    withdraw: 'WITHDRAW',
    tripCircuitBreaker: 'TRIP_BREAKER',
    resetCircuitBreaker: 'RESET_BREAKER',
    advanceTime: 'ADVANCE_TIME',
  },
  PolicyEngine: {
    setSafetyHorizon: 'SET_POLICY',
    setEmergencyBuffer: 'SET_POLICY',
    setMaxExposureBps: 'SET_POLICY',
    setAdapterStatus: 'SET_ADAPTER_STATUS',
  },
  MockLendingPool: {
    setAPY: 'POOL_CONTROL',
    setPaused: 'POOL_CONTROL',
    setUtilization: 'POOL_CONTROL',
    setLiquidityShortage: 'POOL_CONTROL',
  },
} as const satisfies Record<AdminContract, Record<string, TransactionKind>>;

export const ADMIN_ABIS: Record<AdminContract, Abi> = {
  Treasury: treasuryAbi as Abi,
  PolicyEngine: policyEngineAbi as Abi,
  MockLendingPool: mockLendingPoolAbi as Abi,
};

export interface VerifiedAdminCall {
  contract: AdminContract;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  kind: TransactionKind;
}

export function adminKind(contract: AdminContract, functionName: string): TransactionKind | null {
  return (ADMIN_FUNCTIONS[contract] as Record<string, TransactionKind>)[functionName] ?? null;
}

/**
 * Throws unless `tx` targets `expected.address` on `expected.chainId`, carries no native value and decodes to one of
 * the allowed functions of `expected.contract` (optionally exactly `expected.functionName`).
 */
export function verifyAdminTx(
  tx: Pick<PreparedTx, 'to' | 'data' | 'value' | 'chainId'> & { functionName?: string },
  expected: { contract: AdminContract; address: Address; chainId: number; functionName?: string },
): VerifiedAdminCall {
  if (tx.chainId !== expected.chainId) throw new Error(`Prepared tx targets chain ${tx.chainId}, expected ${expected.chainId}`);
  if (!isAddressEqual(tx.to, expected.address)) throw new Error(`Prepared tx is not addressed to the ${expected.contract}`);
  if (tx.value !== '0') throw new Error('Prepared tx must not transfer native value');
  const abi = ADMIN_ABIS[expected.contract];
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi, data: tx.data }) as typeof decoded;
  } catch {
    throw new Error(`Prepared tx calldata is not a ${expected.contract} call`);
  }
  const kind = adminKind(expected.contract, decoded.functionName);
  if (!kind) throw new Error(`${expected.contract}.${decoded.functionName} is not an allowed admin action`);
  if (expected.functionName && decoded.functionName !== expected.functionName) {
    throw new Error(`Prepared tx calls ${decoded.functionName}, expected ${expected.functionName}`);
  }
  if (tx.functionName && tx.functionName !== decoded.functionName) {
    throw new Error(`Prepared tx label ${tx.functionName} does not match its calldata (${decoded.functionName})`);
  }
  return {
    contract: expected.contract,
    address: expected.address,
    abi,
    functionName: decoded.functionName,
    args: decoded.args ?? [],
    kind,
  };
}
