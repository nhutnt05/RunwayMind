'use client';

import { AdapterCard } from '@/components/vault/AdapterCard';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';
import { policyHeadroom } from '@/lib/views';

export default function VaultPage() {
  const overview = useOverview();
  const chain = useTreasuryReads();
  const gate = useAdminGate();
  const o = overview.data?.data;

  return (
    <>
      <PageHeader title="Yield Vault" description="Adapter balances, APY, liquidity and manual invest / withdraw." />
      {overview.isError && !o ? (
        <ErrorState title="Could not load adapters" message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
      ) : !o ? (
        <Skeleton className="h-64 w-full" />
      ) : o.adapters.length === 0 ? (
        <EmptyState title="No yield vaults" description="Whitelisted adapters appear here after deployment." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {o.adapters.map((a) => (
            <AdapterCard
              key={a.address}
              adapter={a}
              gate={gate}
              headroom={policyHeadroom({
                // live chain reads first (docs/08 §5), backend overview as fallback
                idle: chain.data?.idleBalance ?? BigInt(o.idle),
                requiredReserve: chain.data?.requiredReserve ?? BigInt(o.requiredReserve),
                totalAssets: chain.data?.totalAssets ?? BigInt(o.totalAssets),
                maxExposureBps: o.policy.maxExposureBps,
                adapterBalance: BigInt(a.balance),
                adapterActive: a.status === 'ACTIVE',
                circuitBreakerActive: chain.data?.circuitBreakerActive ?? o.circuitBreakerActive,
              })}
            />
          ))}
        </div>
      )}
    </>
  );
}
