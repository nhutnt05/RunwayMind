'use client';

import { useAccount, useReadContract } from 'wagmi';
import { appChain } from '@/lib/chains';
import { DEFAULT_ADMIN_ROLE, contracts } from '@/lib/contracts';

/** On-chain hasRole(DEFAULT_ADMIN_ROLE, account) — UI convenience only; contracts enforce (docs/08 §7). */
export function useIsAdmin() {
  const { address } = useAccount();
  const treasury = contracts?.treasury;
  const { data, isLoading } = useReadContract({
    ...(treasury ?? { address: undefined, abi: [] }),
    functionName: 'hasRole',
    args: address ? [DEFAULT_ADMIN_ROLE, address] : undefined,
    chainId: appChain.id,
    query: { enabled: Boolean(treasury && address), refetchInterval: 30_000 },
  } as never);
  return { isAdmin: data === true, isLoading };
}
