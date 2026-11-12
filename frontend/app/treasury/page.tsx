'use client';

import dynamic from 'next/dynamic';
import { AdapterTable, AddressList, BreakerPanel, ClockPanel } from '@/components/treasury/TreasuryPanels';
import { AdminGateNotice, ErrorState, PageHeader, SkeletonCard, SkeletonGrid } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';

// Recharts (~100 kB) loads after the page shell; a card skeleton holds the space meanwhile.
const AllocationDonut = dynamic(() => import('@/components/treasury/AllocationDonut').then((m) => m.AllocationDonut), {
  ssr: false,
  loading: () => <SkeletonCard label="allocation chart" bodyClassName="h-56" />,
});

export default function TreasuryPage() {
  const gate = useAdminGate();
  const overview = useOverview();
  const chain = useTreasuryReads();
  const o = overview.data?.data;
  const breaker = chain.data?.circuitBreakerActive ?? o?.circuitBreakerActive ?? false;

  return (
    <>
      <PageHeader title="Treasury" description="Contracts, allocation, adapters, policy parameters and the circuit breaker." />
      <AdminGateNotice gate={gate} context="Circuit breaker controls are disabled." />
      {overview.isError && !o ? (
        <ErrorState title="Could not load the treasury" message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
      ) : !o ? (
        <SkeletonGrid label="treasury" count={4} className="grid grid-cols-1 gap-4 lg:grid-cols-2" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <AddressList overview={o} />
          </div>
          <div className="lg:col-span-5">
            <AllocationDonut idle={o.idle} vault={o.vaultTotal} decimals={o.asset.decimals} />
          </div>
          <div className="lg:col-span-12">
            <AdapterTable overview={o} />
          </div>
          <div className="lg:col-span-6">
            <BreakerPanel active={breaker} />
          </div>
          <div className="lg:col-span-6">
            <ClockPanel chainTime={chain.data ? Number(chain.data.currentTime) : o.chainTime} timeOffset={o.timeOffset} demoMode={o.demoMode} />
          </div>
        </div>
      )}
    </>
  );
}
