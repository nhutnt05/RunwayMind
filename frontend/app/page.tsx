'use client';

import { EfficiencyGauge } from '@/components/dashboard/EfficiencyGauge';
import { UpcomingObligationsList } from '@/components/dashboard/UpcomingObligationsList';
import { WithdrawalTimeline } from '@/components/dashboard/WithdrawalTimeline';
import { AmountText, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui';
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

  const o = overview.data?.data;
  // Fresh on-chain reads take precedence for balances (docs/08 §5); backend analytics fill in the rest.
  const idle = chain.data?.idleBalance ?? (o ? BigInt(o.idle) : undefined);
  const required = chain.data?.requiredReserve ?? (o ? BigInt(o.requiredReserve) : undefined);
  const total = chain.data?.totalAssets ?? (o ? BigInt(o.totalAssets) : undefined);
  const shortfall = chain.data?.shortfall ?? (o ? BigInt(o.shortfall) : 0n);
  const chainTime = chain.data ? Number(chain.data.currentTime) : (o?.chainTime ?? 0);
  const demoStartTime = o?.demoStartTime ?? null;
  const loading = overview.isLoading && !o;

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
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
        {/* Row 1 — four StatCards */}
        <div className="lg:col-span-3">
          <StatCard title="Total assets" value={total === undefined ? <Skeleton className="mt-2 h-7 w-32" /> : <AmountText value={total} />} />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            title="Idle (Liquidity Reserve)"
            tone={shortfall > 0n ? 'danger' : 'default'}
            value={idle === undefined ? <Skeleton className="mt-2 h-7 w-32" /> : <AmountText value={idle} />}
            subLabel={
              required === undefined ? null : (
                <>
                  Required: <AmountText value={required} symbol={null} />
                  {shortfall > 0n ? (
                    <span className="ml-1 font-semibold text-red-700">
                      · shortfall <AmountText value={shortfall} symbol={null} />
                    </span>
                  ) : null}
                </>
              )
            }
          />
        </div>
        <div className="lg:col-span-3">
          <StatCard title="In Yield Vault" value={o ? <AmountText value={o.vaultTotal} /> : <Skeleton className="mt-2 h-7 w-32" />} />
        </div>
        <div className="lg:col-span-3">
          <StatCard
            title="Accrued yield"
            value={o?.accruedYield ? <AmountText value={o.accruedYield} /> : loading ? <Skeleton className="mt-2 h-7 w-32" /> : '—'}
            subLabel={o && !o.accruedYield ? 'Available once the event indexer runs' : null}
          />
        </div>

        {/* Row 2 — efficiency (runway meter and yield ticker arrive in D5) */}
        <div className="md:col-span-2 lg:col-span-6">
          {o ? (
            <EfficiencyGauge actualBps={o.actualEfficiencyBps} targetBps={o.capitalEfficiencyBps} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </div>

        {/* Row 3 — upcoming obligations */}
        <div className="md:col-span-2 lg:col-span-6">
          {obligations.data ? (
            <UpcomingObligationsList obligations={obligations.data.data} chainTime={chainTime} demoStartTime={demoStartTime} />
          ) : obligations.isError ? (
            <ErrorState title="Could not load obligations" onRetry={() => void obligations.refetch()} />
          ) : (
            <Skeleton className="h-48 w-full" />
          )}
        </div>

        {/* Row 4 — withdrawal timeline */}
        <div className="md:col-span-2 lg:col-span-12">
          {schedule.data ? (
            <WithdrawalTimeline items={schedule.data.data.items} chainTime={chainTime} demoStartTime={demoStartTime} />
          ) : schedule.isError ? (
            <ErrorState title="Could not load the withdrawal schedule" onRetry={() => void schedule.refetch()} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
      </div>
    </>
  );
}
