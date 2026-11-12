'use client';

import type { ReactNode } from 'react';
import { AccruedYieldTicker } from '@/components/dashboard/AccruedYieldTicker';
import { EfficiencyGauge } from '@/components/dashboard/EfficiencyGauge';
import { RunwayMeter } from '@/components/dashboard/RunwayMeter';
import { UpcomingObligationsList } from '@/components/dashboard/UpcomingObligationsList';
import { WithdrawalTimeline } from '@/components/dashboard/WithdrawalTimeline';
import { RecommendationList } from '@/components/recommendations/RecommendationList';
import { AdminGateNotice, AmountText, ErrorState, PageHeader, Skeleton, SkeletonCard, StaleDataNotice, StatCard } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useActiveObligations, useOverview, useWithdrawalSchedule } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';

function lastUpdated(ms: number): string | undefined {
  return ms ? new Date(ms).toLocaleTimeString() : undefined;
}

export default function DashboardPage() {
  const overview = useOverview();
  const obligations = useActiveObligations();
  const schedule = useWithdrawalSchedule();
  const chain = useTreasuryReads();
  const gate = useAdminGate();

  const o = overview.data?.data;
  // Fresh on-chain reads take precedence for balances (docs/08 §5); backend analytics fill in the rest.
  const idle = chain.data?.idleBalance ?? (o ? BigInt(o.idle) : undefined);
  const required = chain.data?.requiredReserve ?? (o ? BigInt(o.requiredReserve) : undefined);
  const total = chain.data?.totalAssets ?? (o ? BigInt(o.totalAssets) : undefined);
  const shortfall = chain.data?.shortfall ?? (o ? BigInt(o.shortfall) : 0n);
  const chainTime = chain.data ? Number(chain.data.currentTime) : (o?.chainTime ?? 0);
  const demoStartTime = o?.demoStartTime ?? null;
  const loading = overview.isLoading && !o;
  // While loading show a skeleton; once the API has failed with nothing cached show "—" (the ErrorState explains why).
  const pending = (node: ReactNode) => (overview.isError && !o && !chain.data ? '—' : node);
  const valueSkeleton = pending(<Skeleton className="mt-2 h-7 w-32" />);

  return (
    <>
      <PageHeader title="Dashboard" description="Treasury health, Cash Ladder and agent recommendations at a glance." />

      {overview.isError && !o ? (
        <div className="mb-4">
          <ErrorState
            title="Could not load treasury data"
            message={(overview.error as Error).message}
            onRetry={() => void overview.refetch()}
            lastUpdated={lastUpdated(overview.dataUpdatedAt)}
          />
        </div>
      ) : overview.isError && o ? (
        <div className="mb-4">
          <StaleDataNotice lastUpdated={lastUpdated(overview.dataUpdatedAt)} onRetry={() => void overview.refetch()} />
        </div>
      ) : null}
      {/* Read-only dashboard + "Connect wallet to manage" (docs/08 §8) */}
      <AdminGateNotice gate={gate} context="The dashboard is read-only; Approve / Reject are disabled." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
        {/* Row 1 — four StatCards */}
        <div className="lg:col-span-3">
          <StatCard title="Total assets" value={total === undefined ? valueSkeleton : <AmountText value={total} />} />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            title="Idle (Liquidity Reserve)"
            tone={shortfall > 0n ? 'danger' : 'default'}
            value={idle === undefined ? valueSkeleton : <AmountText value={idle} />}
            subLabel={
              required === undefined ? null : (
                <>
                  Required: <AmountText value={required} symbol={null} />
                  {shortfall > 0n ? (
                    <span className="ml-1 font-semibold text-red-800">
                      <span aria-hidden>▲ </span>shortfall <AmountText value={shortfall} symbol={null} />
                    </span>
                  ) : null}
                </>
              )
            }
          />
        </div>
        <div className="lg:col-span-3">
          <StatCard title="In Yield Vault" value={o ? <AmountText value={o.vaultTotal} /> : valueSkeleton} />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            title="Accrued yield"
            value={o?.accruedYield ? <AmountText value={o.accruedYield} /> : loading ? <Skeleton className="mt-2 h-7 w-32" /> : '—'}
            subLabel={o && !o.accruedYield ? 'Available once the event indexer runs' : null}
          />
        </div>

        {/* Row 2 — RunwayMeter (4) + EfficiencyGauge (4) + AccruedYieldTicker (4) (docs/08 §2) */}
        <div className="lg:col-span-4">
          <RunwayMeter />
        </div>
        <div className="lg:col-span-4">
          {o ? (
            <EfficiencyGauge actualBps={o.actualEfficiencyBps} targetBps={o.capitalEfficiencyBps} />
          ) : overview.isError ? (
            <ErrorState title="Capital efficiency unavailable" onRetry={() => void overview.refetch()} />
          ) : (
            <SkeletonCard label="capital efficiency" lines={2} className="h-full" />
          )}
        </div>
        <div className="md:col-span-2 lg:col-span-4">
          <AccruedYieldTicker />
        </div>

        {/* Row 3 — recommendations (7) + upcoming obligations (5) */}
        <div className="md:col-span-2 lg:col-span-7">
          <RecommendationList />
        </div>
        <div className="md:col-span-2 lg:col-span-5">
          {obligations.data ? (
            <UpcomingObligationsList obligations={obligations.data.data} chainTime={chainTime} demoStartTime={demoStartTime} />
          ) : obligations.isError ? (
            <ErrorState title="Could not load obligations" onRetry={() => void obligations.refetch()} />
          ) : (
            <SkeletonCard label="upcoming obligations" lines={4} />
          )}
        </div>

        {/* Row 4 — withdrawal timeline */}
        <div className="md:col-span-2 lg:col-span-12">
          {schedule.data ? (
            <WithdrawalTimeline items={schedule.data.data.items} chainTime={chainTime} demoStartTime={demoStartTime} />
          ) : schedule.isError ? (
            <ErrorState title="Could not load the withdrawal schedule" onRetry={() => void schedule.refetch()} />
          ) : (
            <SkeletonCard label="withdrawal timeline" bodyClassName="h-24" />
          )}
        </div>
      </div>
    </>
  );
}
