'use client';

import { useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatUsdc } from '@runwaymind/shared';
import { dayLabel } from '@/lib/dashboard';
import { DateRangeFilter } from '@/components/cashLadder/DateRangeFilter';
import { CalendarIcon } from '@/components/ui/icons';
import { chartRowsInRange, utcDayKey, type ChartRow } from '@/lib/views';

// Series colours (validated with the dataviz palette checker: CVD + contrast pass on white). The reserve is a
// threshold, so it is drawn in neutral ink as a dashed line rather than another hue.
const SERIES = {
  idle: { color: '#0d9488', fill: '#99f6e4', name: 'Idle cash', help: 'Cash in the treasury, ready to pay at once.' },
  vault: { color: '#6366f1', fill: '#a5b4fc', name: 'In vault', help: 'Invested for yield; must be withdrawn before it can pay.' },
  payments: { color: '#d97706', name: 'Payments due', help: 'Obligations paid out on that day.' },
  required: { color: '#0f172a', name: 'Required reserve', help: 'Idle cash needed to cover upcoming payments safely.' },
} as const;

/** "12,500.00" → compact axis tick: 12.5k, 1.2M (axis geometry only; exact amounts live in the tooltip). */
function compact(v: number): string {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${+(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/** DD/MM for axis ticks; the tooltip shows the full DD/MM/YY. */
const shortDate = (t: number) => dayLabel(t).slice(0, 5);

function Swatch({ kind }: { kind: keyof typeof SERIES }) {
  if (kind === 'required') return <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-slate-900" />;
  if (kind === 'payments') return <span aria-hidden className="inline-block h-3 w-1.5 rounded-sm" style={{ background: SERIES.payments.color }} />;
  const s = SERIES[kind];
  return <span aria-hidden className="inline-block h-3 w-3 rounded-sm border" style={{ background: s.fill, borderColor: s.color }} />;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const line = (kind: keyof typeof SERIES, v: string) => (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-2 text-slate-600">
        <Swatch kind={kind} />
        {SERIES[kind].name}
      </span>
      <span className="font-medium tabular-nums text-slate-900">{formatUsdc(BigInt(v))}</span>
    </div>
  );
  return (
    <div className="min-w-56 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-900">
        {dayLabel(row.date)}
        {row.day === 0 ? <span className="ml-1 font-normal text-slate-500">(today)</span> : null}
      </p>
      {line('idle', row.exact.idle)}
      {line('vault', row.exact.vault)}
      {line('required', row.exact.required)}
      {BigInt(row.exact.payments) > 0n ? line('payments', row.exact.payments) : null}
      {BigInt(row.exact.withdrawals) > 0n ? (
        <p className="border-t border-slate-100 pt-1 text-slate-600">
          Withdraw from vault: <span className="font-medium tabular-nums text-slate-900">{formatUsdc(BigInt(row.exact.withdrawals))}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * docs/08 §3.4: stacked area idle/vault, line required reserve, bars payments; tooltip shows exact amounts
 * (from the decimal strings, not the chart geometry). X axis shows calendar dates (DD/MM).
 */
export function LiquidityProjectionChart({ rows: allRows }: { rows: ChartRow[] }) {
  // Date filter as UTC day keys (null = edge of the projection), so a selection survives chain-time refetches.
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const rows = useMemo(() => chartRowsInRange(allRows, from, to), [allRows, from, to]);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const dates = useMemo(() => allRows.map((r) => r.date), [allRows]);
  // Indexes of the shown range inside the full projection (rows are a contiguous slice of allRows).
  const fromIndex = first ? allRows.indexOf(first) : 0;
  const toIndex = last ? allRows.indexOf(last) : 0;
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = fromIndex !== 0 || toIndex !== dates.length - 1;
  const setRange = (f: number, t: number) => {
    setFrom(f === 0 ? null : utcDayKey(dates[f]!));
    setTo(t === dates.length - 1 ? null : utcDayKey(dates[t]!));
  };
  return (
    <section aria-labelledby="liquidity-projection-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="liquidity-projection-title" className="text-sm font-semibold text-slate-900">
          Liquidity projection
        </h2>
        {dates.length > 1 ? (
          <button
            type="button"
            aria-expanded={filterOpen}
            aria-controls="liquidity-date-filter"
            onClick={() => setFilterOpen((o) => !o)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              filtered ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <CalendarIcon className="h-4 w-4" />
            {filtered && first && last ? (
              <span className="tabular-nums">
                {dayLabel(first.date)} → {dayLabel(last.date)}
              </span>
            ) : (
              'Filter dates'
            )}
            <span aria-hidden className={`text-[10px] transition-transform ${filterOpen ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>
        ) : null}
      </div>
      {filterOpen ? (
        <div id="liquidity-date-filter" className="mt-3">
          <DateRangeFilter dates={dates} fromIndex={fromIndex} toIndex={toIndex} onChange={setRange} />
        </div>
      ) : null}
      <p className="mt-1 max-w-prose text-xs text-slate-600">
        How the treasury balance is expected to change. The coloured areas are the money held; it stays healthy while the{' '}
        <span className="font-medium text-slate-800">idle cash</span> (green) is at or above the dashed{' '}
        <span className="font-medium text-slate-800">required reserve</span> line. Hover a day for exact amounts.
      </p>

      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2" aria-label="Chart legend">
        {(Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => (
          <li key={k} className="flex items-start gap-2">
            <span className="mt-1 flex w-4 shrink-0 justify-center">
              <Swatch kind={k} />
            </span>
            <span>
              <span className="font-medium text-slate-800">{SERIES[k].name}</span>
              <span className="text-slate-500"> — {SERIES[k].help}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="sr-only">
        Chart from {first ? dayLabel(first.date) : ''} to {last ? dayLabel(last.date) : ''}. The withdrawal schedule and projected occurrences
        tables below list the exact amounts.
      </p>
      <div className="mt-3 h-80 w-full" aria-hidden>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              fontSize={11}
              stroke="#94a3b8"
              tick={{ fill: '#475569' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis fontSize={11} width={48} stroke="#94a3b8" tick={{ fill: '#475569' }} tickLine={false} axisLine={false} tickFormatter={compact} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
            <Area type="stepAfter" dataKey="idleTokens" name={SERIES.idle.name} stackId="assets" stroke={SERIES.idle.color} strokeWidth={2} fill={SERIES.idle.fill} fillOpacity={0.8} />
            {/* No outline on the vault band: stacked on idle, a zero vault would draw its colour along the idle edge. */}
            <Area type="stepAfter" dataKey="vaultTokens" name={SERIES.vault.name} stackId="assets" stroke="none" fill={SERIES.vault.fill} fillOpacity={0.7} />
            <Bar dataKey="paymentsTokens" name={SERIES.payments.name} fill={SERIES.payments.color} barSize={8} radius={[3, 3, 0, 0]} />
            <Line
              type="stepAfter"
              dataKey="requiredTokens"
              name={SERIES.required.name}
              stroke={SERIES.required.color}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
