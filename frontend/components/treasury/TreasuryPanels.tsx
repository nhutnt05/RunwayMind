'use client';

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatUsdc } from '@runwaymind/shared';
import { AddressChip, AmountText, GatedButton, SnowtraceLink, StateChip } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useAdminWrite } from '@/hooks/useAdminWrite';
import type { TreasuryOverview } from '@/lib/api';
import { contracts, deployment } from '@/lib/contracts';
import { bpsToPercentText, toChartTokens } from '@/lib/views';

export function AddressList({ overview }: { overview: TreasuryOverview }) {
  const rows: [string, string | undefined][] = [
    ['Treasury', overview.treasury],
    [`Asset (${overview.asset.symbol})`, overview.asset.address],
    ['ObligationRegistry', contracts?.registry.address],
    ['PolicyEngine', contracts?.policy.address],
    ['MockLendingPool', contracts?.pool.address],
    ['ADMIN', deployment?.roles.admin],
    ['AGENT', deployment?.roles.agent],
  ];
  return (
    <section aria-label="Contracts and roles" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Contracts &amp; roles</h2>
      <dl className="space-y-2 text-sm">
        {rows
          .filter((r): r is [string, string] => Boolean(r[1]))
          .map(([label, address]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-slate-600">{label}</dt>
              <dd className="flex items-center gap-2">
                <AddressChip address={address} />
                <SnowtraceLink kind="address" value={address}>
                  Snowtrace
                </SnowtraceLink>
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

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

export function AdapterTable({ overview }: { overview: TreasuryOverview }) {
  return (
    <section aria-label="Adapters" className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">Adapters &amp; policy</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="px-4 py-2">Adapter</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Balance</th>
            <th className="px-4 py-2 text-right">APY</th>
            <th className="px-4 py-2 text-right">Utilization</th>
          </tr>
        </thead>
        <tbody>
          {overview.adapters.map((a) => (
            <tr key={a.address} className="border-t border-slate-100">
              <td className="px-4 py-2">
                <div className="font-medium">{a.name}</div>
                <AddressChip address={a.address} />
              </td>
              <td className="px-4 py-2">
                <StateChip state={a.status} />
                {a.paused ? <StateChip state="PAUSED" tone="danger" /> : null}
              </td>
              <td className="px-4 py-2 text-right">
                <AmountText value={a.balance} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{bpsToPercentText(a.apyBps)}%</td>
              <td className="px-4 py-2 text-right tabular-nums">{bpsToPercentText(a.utilizationBps)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="grid grid-cols-3 gap-4 border-t border-slate-100 p-4 text-sm">
        <div>
          <dt className="text-xs text-slate-600">Safety horizon H</dt>
          <dd className="font-semibold">{Math.floor(overview.policy.safetyHorizonSec / 86_400)} days</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Emergency buffer</dt>
          <dd className="font-semibold">
            <AmountText value={overview.policy.emergencyBuffer} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Max exposure</dt>
          <dd className="font-semibold">{bpsToPercentText(overview.policy.maxExposureBps)}%</dd>
        </div>
      </dl>
    </section>
  );
}

/** Circuit breaker (R6): Trip = ADMIN or AGENT on-chain (UI offers it to ADMIN); Reset = ADMIN only. */
export function BreakerPanel({ active }: { active: boolean }) {
  const gate = useAdminGate();
  const write = useAdminWrite();
  const busy = write.isPending;
  return (
    <section aria-label="Circuit breaker" className={`rounded-xl border p-4 shadow-sm ${active ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Circuit breaker (R6)</h2>
        <StateChip state={active ? 'TRIPPED' : 'NORMAL'} tone={active ? 'danger' : 'success'} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        While tripped, no new investments are possible; withdrawals and payments keep working. ADMIN or AGENT can trip; only ADMIN can reset.
      </p>
      <div className="mt-3 flex gap-2">
        <GatedButton
          gate={gate}
          disabled={busy || active}
          onClick={() => {
            if (window.confirm('Trip the circuit breaker? New investments will be blocked until an ADMIN resets it.')) {
              write.mutate({ title: 'Trip circuit breaker', contract: 'Treasury', call: { functionName: 'tripCircuitBreaker', args: [] } });
            }
          }}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white"
        >
          Trip
        </GatedButton>
        <GatedButton
          gate={gate}
          disabled={busy || !active}
          onClick={() => write.mutate({ title: 'Reset circuit breaker', contract: 'Treasury', call: { functionName: 'resetCircuitBreaker', args: [] } })}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
        >
          Reset
        </GatedButton>
      </div>
      {write.error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {write.error.message}
        </p>
      ) : null}
    </section>
  );
}

/** DEMO: chain time (Treasury.currentTime()) vs wall clock, so the time offset is visible. */
export function ClockPanel({ chainTime, timeOffset, demoMode }: { chainTime: number; timeOffset: number; demoMode: boolean }) {
  const iso = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return (
    <section aria-label="Clock" className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <h2 className="mb-2 font-semibold text-slate-900">Clock</h2>
      <p>
        Chain time: <span className="tabular-nums">{iso(chainTime)}</span>
      </p>
      {demoMode ? (
        <p className="text-slate-600">
          Wall clock: <span className="tabular-nums">{iso(Math.floor(Date.now() / 1000))}</span> · offset +{Math.floor(timeOffset / 86_400)} d{' '}
          {Math.floor((timeOffset % 86_400) / 3600)} h
        </p>
      ) : null}
    </section>
  );
}
