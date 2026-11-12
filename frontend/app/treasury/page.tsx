'use client';

import { AdapterTable, AddressList, AllocationDonut, BreakerPanel, ClockPanel } from '@/components/treasury/TreasuryPanels';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';

export default function TreasuryPage() {
  const overview = useOverview();
  const chain = useTreasuryReads();
  const o = overview.data?.data;
  const breaker = chain.data?.circuitBreakerActive ?? o?.circuitBreakerActive ?? false;

  return (
    <>
      <PageHeader title="Treasury" description="Contracts, allocation, adapters, policy parameters and the circuit breaker." />
      {overview.isError && !o ? (
        <ErrorState title="Could not load the treasury" message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
      ) : !o ? (
        <Skeleton className="h-64 w-full" />
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
