'use client';

import { AdapterCard } from '@/components/vault/AdapterCard';
import { AdminGateNotice, EmptyState, ErrorState, PageHeader, SkeletonGrid } from '@/components/ui';
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
      <AdminGateNotice gate={gate} context="Invest and withdraw are disabled." />
      {overview.isError && !o ? (
        <ErrorState title="Could not load adapters" message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
      ) : !o ? (
        <SkeletonGrid label="yield vault adapters" count={2} />
      ) : o.adapters.length === 0 ? (
        <EmptyState
          title="No yield vaults"
          description="Whitelisted adapters appear here after deployment. An ADMIN can whitelist one in Settings."
          action={{ label: 'Open settings', href: '/settings' }}
        />
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
