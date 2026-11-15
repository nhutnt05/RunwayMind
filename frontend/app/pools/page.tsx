'use client';

import { AddressChip, AmountText, EmptyState, ErrorState, PageHeader, Skeleton, SkeletonGrid, StateChip } from '@/components/ui';
import { usePool, usePools, type PoolDetailJson, type PoolJson } from '@/hooks/useApiQueries';
import { PoolHistoryCharts } from '@/components/pools/PoolHistoryCharts';
import { RiskScoreGauge } from '@/components/pools/RiskScoreGauge';
import { bpsToPercentText } from '@/lib/views';

function RiskComponentBars({ risk }: { risk: PoolDetailJson['risk'] }) {
  const rows: [string, number, string][] = [
    ['Utilization', risk.components.utilization, '50%'],
    ['APY volatility', risk.components.apyVolatility, '30%'],
    ['TVL', risk.components.tvl, '20%'],
  ];
  return (
    <div role="group" className="space-y-2" aria-label="Risk components">
      {rows.map(([label, value, weight]) => (
        <div key={label}>
          <div className="flex justify-between text-xs text-slate-700">
            <span>
              {label} <span className="text-slate-600">(weight {weight})</span>
            </span>
            <span className="tabular-nums">{value.toFixed(2)}</span>
          </div>
          <div className="mt-0.5 h-2 rounded bg-slate-100">
            <div className="h-2 rounded bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-600">
        Paused gate: {risk.components.paused ? <StateChip state="PAUSED → score 0" tone="danger" /> : 'not paused'} · samples used {risk.samplesUsed} / 20
      </p>
    </div>
  );
}

function PoolCard({ pool }: { pool: PoolJson }) {
  const detail = usePool(pool.address);
  const d = detail.data?.data;
  return (
    <article aria-label={pool.name} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">{pool.name}</h2>
          <AddressChip address={pool.address} />
        </div>
        <StateChip state={pool.band} />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col items-center">
          <RiskScoreGauge score={pool.riskScore} band={pool.band} />
          <dl className="mt-1 grid w-full grid-cols-2 gap-1 text-xs text-slate-700">
            <dt>APY</dt>
            <dd className="text-right tabular-nums">{bpsToPercentText(pool.apyBps)}%</dd>
            <dt>Utilization</dt>
            <dd className="text-right tabular-nums">{bpsToPercentText(pool.utilizationBps)}%</dd>
            <dt>TVL</dt>
            <dd className="text-right">
              <AmountText value={pool.tvl} />
            </dd>
            <dt>Liquidity</dt>
            <dd className="text-right">
              <AmountText value={pool.availableLiquidity} />
            </dd>
          </dl>
        </div>
        {d ? (
          <RiskComponentBars risk={d.risk} />
        ) : detail.isError ? (
          <ErrorState title="Could not load risk details" onRetry={() => void detail.refetch()} />
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </div>
      <div className="mt-4">{d ? <PoolHistoryCharts history={d.riskHistory} samples={d.samples} /> : null}</div>
    </article>
  );
}

export default function PoolsPage() {
  const pools = usePools();
  const list = pools.data?.data;
  return (
    <>
      <PageHeader title="Pool Risk Dashboard" description="How safe each lending pool is, as a safety score from 0 to 100 (higher is safer), based on utilization, APY volatility, TVL and pause status." />
      {pools.isError && !list ? (
        <ErrorState title="Could not load pools" message={(pools.error as Error).message} onRetry={() => void pools.refetch()} />
      ) : !list ? (
        <SkeletonGrid label="pool risk scores" count={2} className="grid grid-cols-1 gap-4 xl:grid-cols-2" />
      ) : list.length === 0 ? (
        <EmptyState title="No pool risk data yet" description="Risk scores appear after the agent samples pool metrics." />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {list.map((p) => (
            <PoolCard key={p.address} pool={p} />
          ))}
        </div>
      )}
    </>
  );
}
