'use client';

import { useReadContracts } from 'wagmi';
import { appChain } from '@/lib/chains';
import { contracts } from '@/lib/contracts';

const FUNCTIONS = [
  'idleBalance',
  'totalAssets',
  'requiredReserve',
  'shortfall',
  'circuitBreakerActive',
  'demoMode',
  'timeOffset',
  'currentTime',
] as const;

export interface TreasuryReads {
  idleBalance: bigint;
  totalAssets: bigint;
  requiredReserve: bigint;
  shortfall: bigint;
  circuitBreakerActive: boolean;
  demoMode: boolean;
  timeOffset: bigint;
  currentTime: bigint;
}

/** Live Treasury state straight from chain (docs/08 §5: multicall, refetch every 5 s). */
export function useTreasuryReads() {
  const treasury = contracts?.treasury;
  const query = useReadContracts({
    allowFailure: false,
    contracts: treasury
      ? FUNCTIONS.map((functionName) => ({ ...treasury, functionName, chainId: appChain.id }))
      : [],
    query: { enabled: Boolean(treasury), refetchInterval: 5_000 },
  });
  const data: TreasuryReads | undefined = query.data
    ? (Object.fromEntries(FUNCTIONS.map((fn, i) => [fn, (query.data as unknown[])[i]])) as unknown as TreasuryReads)
    : undefined;
  return { ...query, data, configured: Boolean(treasury) };
}
