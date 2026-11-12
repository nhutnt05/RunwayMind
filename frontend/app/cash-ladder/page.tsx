'use client';

import { useMemo, useState } from 'react';
import { LadderSummary, OccurrencesTable, WithdrawalScheduleTable } from '@/components/cashLadder/LadderTables';
import { LiquidityProjectionChart } from '@/components/cashLadder/LiquidityProjectionChart';
import { ErrorState, PageHeader, SkeletonCard } from '@/components/ui';
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
        <label htmlFor="ladder-days" className="flex items-center gap-2 font-medium text-slate-700">
          Projection
          <select id="ladder-days" className="rounded-md border border-slate-300 bg-white px-2 py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PROJECTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="ladder-yield" className="flex items-center gap-2 font-medium text-slate-700">
          <input id="ladder-yield" type="checkbox" checked={includeYield} onChange={(e) => setIncludeYield(e.target.checked)} />
          Include projected yield
        </label>
      </div>

      {ladder.isError && !l ? (
        <ErrorState title="Could not compute the Cash Ladder" message={(ladder.error as Error).message} onRetry={() => void ladder.refetch()} />
      ) : !l || !o ? (
        <div className="space-y-4">
          <SkeletonCard label="ladder summary" lines={2} />
          <SkeletonCard label="liquidity projection" bodyClassName="h-64" />
          <SkeletonCard label="withdrawal schedule" lines={3} />
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
