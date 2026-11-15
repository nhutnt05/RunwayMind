'use client';

// Pool Risk Dashboard history (A-11). Two views behind tabs, each with one meaning per axis:
//  - Safety score over time: 0–100 with the three risk zones shaded.
//  - APY & Utilization: the measured market inputs, both in %.
// The x axis is real time (chain timestamps), so gaps between agent ticks are shown to scale.
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BAND_INFO } from '@/components/pools/RiskScoreGauge';
import { metricSeries, scoreSeries, timeFull, timeTick, type Band, type MetricPoint, type ScorePoint } from '@/lib/poolCharts';

const AXIS = { fontSize: 11, stroke: '#94a3b8', tick: { fill: '#475569' }, tickLine: false } as const;

// Indigo / teal: validated pair (dataviz palette check: CVD + contrast pass); amber is avoided so it is not read as "Watch".
const METRICS = {
  util: { color: '#6366f1', name: 'Utilization', help: 'share of the pool lent out — high means withdrawals may have to wait' },
  apy: { color: '#0d9488', name: 'APY', help: 'yield the pool pays' },
} as const;

const TABS = [
  { key: 'score', label: 'Safety score' },
  { key: 'metrics', label: 'APY & Utilization' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function timeAxis(points: { t: number }[]) {
  const span = points.length ? points[points.length - 1]!.t - points[0]!.t : 0;
  return <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => timeTick(t, span)} minTickGap={28} {...AXIS} />;
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="min-w-44 space-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg">{children}</div>;
}

function ScoreTooltip({ active, payload }: { active?: boolean; payload?: { payload: ScorePoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const info = BAND_INFO[p.band];
  return (
    <Box>
      <p className="font-semibold text-slate-900">{timeFull(p.t)}</p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-slate-600">Safety score</span>
        <span className="font-semibold tabular-nums text-slate-900">{p.score} / 100</span>
      </p>
      <p className={info.text}>
        <span className="font-semibold">{info.label}</span> — {info.meaning}
      </p>
    </Box>
  );
}

function MetricTooltip({ active, payload }: { active?: boolean; payload?: { payload: MetricPoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const row = (k: keyof typeof METRICS, v: number) => (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-slate-600">
        <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: METRICS[k].color }} />
        {METRICS[k].name}
      </span>
      <span className="font-medium tabular-nums text-slate-900">{v.toFixed(2)}%</span>
    </p>
  );
  return (
    <Box>
      <p className="font-semibold text-slate-900">{timeFull(p.t)}</p>
      {row('util', p.util)}
      {row('apy', p.apy)}
    </Box>
  );
}

const notEnough = (what: string) => <p className="flex h-48 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-600">{what}</p>;

function ScoreChart({ scores }: { scores: ScorePoint[] }) {
  if (scores.length < 2) return notEnough('The score history appears after a few agent checks of this pool.');
  return (
    <>
      <p className="mb-1 text-xs text-slate-600">0–100, higher is safer. Shaded zones show what the agent does.</p>
      <div className="h-48" aria-hidden>
        <ResponsiveContainer>
          <LineChart data={scores} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <ReferenceArea y1={70} y2={100} fill={BAND_INFO.HEALTHY.color} fillOpacity={0.08} ifOverflow="hidden" />
            <ReferenceArea y1={40} y2={70} fill={BAND_INFO.WATCH.color} fillOpacity={0.1} ifOverflow="hidden" />
            <ReferenceArea y1={0} y2={40} fill={BAND_INFO.CRITICAL.color} fillOpacity={0.08} ifOverflow="hidden" />
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            {timeAxis(scores)}
            <YAxis domain={[0, 100]} ticks={[0, 40, 70, 100]} width={40} axisLine={false} {...AXIS} />
            <Tooltip content={<ScoreTooltip />} cursor={{ stroke: '#94a3b8' }} />
            <Line type="stepAfter" dataKey="score" stroke="#0f172a" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="Score zones">
        {(['HEALTHY', 'WATCH', 'CRITICAL'] as const).map((b) => (
          <li key={b} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAND_INFO[b].color, opacity: 0.5 }} />
            {BAND_INFO[b].label} {BAND_INFO[b].range}
          </li>
        ))}
      </ul>
      <p className="sr-only">Latest safety score {scores[scores.length - 1]!.score} out of 100.</p>
    </>
  );
}

function MetricsChart({ metrics }: { metrics: MetricPoint[] }) {
  if (metrics.length < 2) return notEnough('APY and utilization history appear after a few agent samples of this pool.');
  const last = metrics[metrics.length - 1]!;
  return (
    <>
      <p className="mb-1 text-xs text-slate-600">Measured pool conditions that feed the score, in %.</p>
      <div className="h-48" aria-hidden>
        <ResponsiveContainer>
          <LineChart data={metrics} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            {timeAxis(metrics)}
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} width={44} axisLine={false} {...AXIS} />
            <Tooltip content={<MetricTooltip />} cursor={{ stroke: '#94a3b8' }} />
            <Line type="stepAfter" dataKey="util" stroke={METRICS.util.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="apy" stroke={METRICS.apy.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600" aria-label="Chart legend">
        {(Object.keys(METRICS) as (keyof typeof METRICS)[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3 shrink-0" style={{ background: METRICS[k].color }} />
            <span>
              <span className="font-medium text-slate-800">{METRICS[k].name}</span> — {METRICS[k].help}
            </span>
          </li>
        ))}
      </ul>
      <p className="sr-only">
        Latest utilization {last.util.toFixed(2)}%, APY {last.apy.toFixed(2)}%.
      </p>
    </>
  );
}

export function PoolHistoryCharts({
  history,
  samples,
}: {
  history: readonly { computedAt: number; score: number; band: Band }[];
  samples: readonly { sampledAt: number; apyBps: number; utilizationBps: number }[];
}) {
  const [tab, setTab] = useState<TabKey>('score');
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // WAI-ARIA tabs: arrow keys / Home / End move between tabs and select them.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]!.key);
    tabRefs.current[next]?.focus();
  };

  return (
    <section className="border-t border-slate-100 pt-3" aria-label="Pool history">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">History</h3>
        <div role="tablist" aria-label="Pool history chart" className="inline-flex rounded-lg bg-slate-100 p-0.5" onKeyDown={onKeyDown}>
          {TABS.map((t, i) => {
            const selected = t.key === tab;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
        {tab === 'score' ? <ScoreChart scores={scoreSeries(history)} /> : <MetricsChart metrics={metricSeries(samples)} />}
      </div>
    </section>
  );
}
