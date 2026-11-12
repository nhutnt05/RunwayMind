'use client';

// Own module so /treasury can load Recharts lazily (next/dynamic): the chart is below the address list and its
// exact values are also printed as text, so the rest of the page does not wait for the chart bundle.
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatUsdc } from '@runwaymind/shared';
import { AmountText } from '@/components/ui';
import { toChartTokens } from '@/lib/views';

const COLORS = ['#14b8a6', '#6366f1'];

export function AllocationDonut({ idle, vault, decimals }: { idle: string; vault: string; decimals: number }) {
  const data = [
    { name: 'Idle', tokens: toChartTokens(idle, decimals), exact: idle },
    { name: 'Yield vault', tokens: toChartTokens(vault, decimals), exact: vault },
  ];
  return (
    <section aria-label="Allocation" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Idle vs vault</h2>
      <div className="h-56">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="tokens" nameKey="name" innerRadius="55%" outerRadius="80%">
              {data.map((d, i) => (
                <Cell key={d.name} fill={COLORS[i]} />
              ))}
            </Pie>
            <Tooltip formatter={(_v, _n, item) => formatUsdc(BigInt((item.payload as { exact: string }).exact), decimals)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <p className="text-center text-xs text-slate-600">
        Idle <AmountText value={idle} decimals={decimals} /> · Vault <AmountText value={vault} decimals={decimals} />
      </p>
    </section>
  );
}
