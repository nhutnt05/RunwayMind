'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AddressChip, AmountText, EmptyState, ErrorState, PageHeader, Skeleton, SkeletonGrid, StateChip } from '@/components/ui';
import { usePool, usePools, useOverview, type PoolDetailJson, type PoolJson } from '@/hooks/useApiQueries';
import { dayLabel } from '@/lib/dashboard';
import { bpsToPercentText } from '@/lib/views';

const BAND_COLOR = { HEALTHY: '#059669', WATCH: '#d97706', CRITICAL: '#dc2626' } as const;

/** 0–100 radial gauge, 100 = safest (A-11). */
function RiskScoreGauge({ score, band }: { score: number; band: PoolJson['band'] }) {
  const arc = Math.PI * 50;
  return (
    <svg viewBox="0 0 120 70" className="h-24 w-full max-w-[200px]" role="img" aria-label={`Risk score ${score} of 100, ${band}`}>
      <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
      <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke={BAND_COLOR[band]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(arc * score) / 100} ${arc}`} />
      <text x="60" y="52" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">
        {score}
      </text>
      <text x="60" y="66" textAnchor="middle" fontSize="8" fill="#475569">
        / 100 · 100 = safest
      </text>
    </svg>
  );
}

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
      <p className="text-xs text-slate-600">Bands: HEALTHY ≥ 70 (may invest) · WATCH 40–69 (hold) · CRITICAL &lt; 40 (withdraw all)</p>
    </div>
  );
}

function RiskHistoryChart({ detail, demoStartTime }: { detail: PoolDetailJson; demoStartTime: number | null }) {
  // Join risk snapshots with metric samples by chain time (oldest → newest).
  const byTime = new Map<number, { t: number; score?: number; apy?: number; util?: number }>();
  for (const r of detail.riskHistory) byTime.set(r.computedAt, { ...(byTime.get(r.computedAt) ?? { t: r.computedAt }), score: r.score });
  for (const s of detail.samples) byTime.set(s.sampledAt, { ...(byTime.get(s.sampledAt) ?? { t: s.sampledAt }), apy: s.apyBps / 100, util: s.utilizationBps / 100 });
  const data = [...byTime.values()].sort((a, b) => a.t - b.t);
  if (data.length < 2) return <p className="text-xs text-slate-600">History appears after a few agent ticks.</p>;
  return (
    <div className="h-48">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="t" tickFormatter={(t: number) => dayLabel(t, demoStartTime)} fontSize={10} />
          <YAxis fontSize={10} domain={[0, 100]} />
          <Tooltip labelFormatter={(t) => dayLabel(Number(t), demoStartTime)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="stepAfter" dataKey="score" name="Risk score" stroke="#4338ca" dot={false} connectNulls />
          <Line type="stepAfter" dataKey="apy" name="APY %" stroke="#059669" dot={false} connectNulls />
          <Line type="stepAfter" dataKey="util" name="Utilization %" stroke="#d97706" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PoolCard({ pool, demoStartTime }: { pool: PoolJson; demoStartTime: number | null }) {
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
      <div className="mt-3">{d ? <RiskHistoryChart detail={d} demoStartTime={demoStartTime} /> : null}</div>
    </article>
  );
}

export default function PoolsPage() {
  const pools = usePools();
  const overview = useOverview();
  const list = pools.data?.data;
  return (
    <>
      <PageHeader title="Pool Risk Dashboard" description="Pool Risk Score (100 = safest) from utilization, APY volatility, TVL and pause status." />
      {pools.isError && !list ? (
        <ErrorState title="Could not load pools" message={(pools.error as Error).message} onRetry={() => void pools.refetch()} />
      ) : !list ? (
        <SkeletonGrid label="pool risk scores" count={2} className="grid grid-cols-1 gap-4 xl:grid-cols-2" />
      ) : list.length === 0 ? (
        <EmptyState title="No pool risk data yet" description="Risk scores appear after the agent samples pool metrics." />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {list.map((p) => (
            <PoolCard key={p.address} pool={p} demoStartTime={overview.data?.data.demoStartTime ?? null} />
          ))}
        </div>
      )}
    </>
  );
}
