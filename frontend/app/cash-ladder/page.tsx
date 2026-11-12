'use client';

import { useMemo, useState } from 'react';
import { LadderSummary, OccurrencesTable, WithdrawalScheduleTable } from '@/components/cashLadder/LadderTables';
import { LiquidityProjectionChart } from '@/components/cashLadder/LiquidityProjectionChart';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useCashLadder, useOverview } from '@/hooks/useApiQueries';
import { ladderChartRows } from '@/lib/views';

const PROJECTION_DAYS = [30, 60, 90, 180, 365] as const;

export default function CashLadderPage() {
  const [days, setDays] = useState<number>(60);
  const [includeYield, setIncludeYield] = useState(true);
  const ladder = useCashLadder(days, includeYield);
  const overview = useOverview();
  const l = ladder.data?.data;
  const o = overview.data?.data;
  const rows = useMemo(() => (l ? ladderChartRows(l.daily, o?.asset.decimals ?? 6) : []), [l, o?.asset.decimals]);

  return (
    <>
      <PageHeader title="Cash Ladder" description="Required reserve, investable capital and the withdrawal schedule that keeps every obligation funded." />

      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Projection
          <select className="rounded-md border border-slate-300 px-2 py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PROJECTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includeYield} onChange={(e) => setIncludeYield(e.target.checked)} />
          Include projected yield
        </label>
      </div>

      {ladder.isError && !l ? (
        <ErrorState title="Could not compute the Cash Ladder" message={(ladder.error as Error).message} onRetry={() => void ladder.refetch()} />
      ) : !l || !o ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <LadderSummary ladder={l} safetyHorizonSec={o.policy.safetyHorizonSec} emergencyBuffer={o.policy.emergencyBuffer} />
          <LiquidityProjectionChart rows={rows} />
          <WithdrawalScheduleTable items={l.withdrawalSchedule} demoStartTime={o.demoStartTime} />
          <OccurrencesTable items={l.occurrences} demoStartTime={o.demoStartTime} />
        </div>
      )}
    </>
  );
}
