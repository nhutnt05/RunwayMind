'use client';

import type { ReactNode } from 'react';
import { AccruedYieldTicker } from '@/components/dashboard/AccruedYieldTicker';
import { EfficiencyGauge } from '@/components/dashboard/EfficiencyGauge';
import { UpcomingObligationsList } from '@/components/dashboard/UpcomingObligationsList';
import { WithdrawalTimeline } from '@/components/dashboard/WithdrawalTimeline';
import { RecommendationList } from '@/components/recommendations/RecommendationList';
import { AdminGateNotice, AmountText, ErrorState, PageHeader, Skeleton, SkeletonCard, StaleDataNotice, StatCard } from '@/components/ui';
import { CashIcon, CheckCircleIcon, LayersIcon, VaultIcon } from '@/components/ui/icons';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useActiveObligations, useOverview, useWithdrawalSchedule } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';
import type { TreasuryOverview } from '@/lib/api';
import { isDust, weightedApyBps } from '@/lib/insights';
import { bpsToPercentText } from '@/lib/views';

/**
 * Vault card footnote. With money in the vault: its balance-weighted APY. With an empty vault that average is 0, so
 * show what the vault could earn instead: the best APY among ACTIVE adapters.
 */
function vaultSubLabel(o: TreasuryOverview): string {
  if (!isDust(BigInt(o.vaultTotal), o.asset.decimals)) return `Earning ${bpsToPercentText(weightedApyBps(o.adapters))}% APY on average`;
  const active = o.adapters.filter((a) => a.status === 'ACTIVE');
  if (!active.length) return 'No active adapter';
  return `Nothing invested yet · pool APY up to ${bpsToPercentText(Math.max(...active.map((a) => a.apyBps)))}%`;
}

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
  const obligationLabels = new Map((obligations.data?.data ?? []).flatMap((ob) => (ob.metadata?.label ? [[ob.id, ob.metadata.label] as const] : [])));
  // While loading show a skeleton; once the source has failed with nothing cached show "—" (the ErrorState explains
  // why). Chain-backed cards (total, idle) can still fill from the RPC; API-only cards (vault) cannot.
  const apiFailed = overview.isError && !o;
  const skeleton: ReactNode = <Skeleton className="mt-2 h-7 w-32" />;
  const valueSkeleton = apiFailed && !chain.data ? '—' : skeleton;
  const apiValueSkeleton = apiFailed ? '—' : skeleton;

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

      {/* Row 1: headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total assets"
          icon={<LayersIcon className="h-4 w-4" />}
          accent="slate"
          value={total === undefined ? valueSkeleton : <AmountText value={total} />}
          subLabel="Idle cash + yield vault"
        />
        <StatCard
          title="Idle (Liquidity Reserve)"
          icon={<CashIcon className="h-4 w-4" />}
          accent="sky"
          tone={shortfall > 0n ? 'danger' : 'default'}
          value={idle === undefined ? valueSkeleton : <AmountText value={idle} />}
          subLabel={
            required === undefined ? null : shortfall > 0n ? (
              <span className="font-semibold text-red-800">
                <span aria-hidden>▲ </span>Short by <AmountText value={shortfall} symbol={null} /> of the required <AmountText value={required} symbol={null} />
              </span>
            ) : (
              <span className="flex items-start gap-1 text-emerald-800">
                <CheckCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Covers the required reserve of <AmountText value={required} symbol={null} />
                </span>
              </span>
            )
          }
        />
        <StatCard
          title="In Yield Vault"
          icon={<VaultIcon className="h-4 w-4" />}
          accent="indigo"
          value={o ? <AmountText value={o.vaultTotal} /> : apiValueSkeleton}
          subLabel={o ? vaultSubLabel(o) : null}
        />
        <AccruedYieldTicker />
      </div>

      {/* Row 2: what needs attention (left) · efficiency and what is due (right) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 [&>section]:h-full">
          <RecommendationList />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-5">
          {o ? (
            <EfficiencyGauge actualBps={o.actualEfficiencyBps} targetBps={o.capitalEfficiencyBps} />
          ) : overview.isError ? (
            <ErrorState title="Capital efficiency unavailable" onRetry={() => void overview.refetch()} />
          ) : (
            <SkeletonCard label="capital efficiency" lines={2} />
          )}
          {obligations.data ? (
            <UpcomingObligationsList obligations={obligations.data.data} chainTime={chainTime} demoStartTime={demoStartTime} />
          ) : obligations.isError ? (
            <ErrorState title="Could not load obligations" onRetry={() => void obligations.refetch()} />
          ) : (
            <SkeletonCard label="upcoming obligations" lines={4} />
          )}
        </div>
      </div>

      {/* Row 3: when money moves back from the vault */}
      <div className="mt-4">
        {schedule.data ? (
          <WithdrawalTimeline items={schedule.data.data.items} chainTime={chainTime} labels={obligationLabels} />
        ) : schedule.isError ? (
          <ErrorState title="Could not load the withdrawal schedule" onRetry={() => void schedule.refetch()} />
        ) : (
          <SkeletonCard label="withdrawal timeline" bodyClassName="h-24" />
        )}
      </div>
    </>
  );
}
