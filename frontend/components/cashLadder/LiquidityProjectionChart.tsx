'use client';

import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatUsdc } from '@runwaymind/shared';
import type { ChartRow } from '@/lib/views';

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const line = (label: string, v: string) => (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="tabular-nums">{formatUsdc(BigInt(v))}</span>
    </div>
  );
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-xs shadow">
      <p className="mb-1 font-semibold">Day {row.day}</p>
      {line('Idle', row.exact.idle)}
      {line('Vault', row.exact.vault)}
      {line('Required reserve', row.exact.required)}
      {line('Payments', row.exact.payments)}
    </div>
  );
}

/**
 * docs/08 §3.4: stacked area idle/vault, line required reserve, bars payments; x = Day N; tooltip shows exact amounts
 * (from the decimal strings, not the chart geometry).
 */
export function LiquidityProjectionChart({ rows }: { rows: ChartRow[] }) {
  return (
    <section aria-label="Liquidity projection" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Liquidity projection</h2>
      <p className="sr-only">
        Chart of projected idle and vault balances against the required reserve, with scheduled payments as bars, from Day{' '}
        {rows[0]?.day ?? 0} to Day {rows[rows.length - 1]?.day ?? 0}. The withdrawal schedule and occurrence tables below list the exact
        amounts.
      </p>
      <div className="h-72 w-full" aria-hidden>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tickFormatter={(d: number) => `D${d}`} fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="stepAfter" dataKey="idleTokens" name="Idle" stackId="assets" stroke="#0f766e" fill="#99f6e4" />
            <Area type="stepAfter" dataKey="vaultTokens" name="Vault" stackId="assets" stroke="#4338ca" fill="#c7d2fe" />
            <Bar dataKey="paymentsTokens" name="Payments" fill="#f59e0b" barSize={6} />
            <Line type="stepAfter" dataKey="requiredTokens" name="Required reserve" stroke="#dc2626" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
