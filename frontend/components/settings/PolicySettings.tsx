'use client';

import { useState } from 'react';
import { useReadContracts } from 'wagmi';
import { keccak256, toBytes, type Address } from 'viem';
import { parseUsdc, type PolicyPrepareRequest } from '@runwaymind/shared';
import { AddressChip, AmountText, GatedButton, StateChip } from '@/components/ui';
import { useAdminWrite } from '@/hooks/useAdminWrite';
import { api, type AdminPrepareResponse, type TreasuryOverview } from '@/lib/api';
import { appChain } from '@/lib/chains';
import { DEFAULT_ADMIN_ROLE, contracts, deployment } from '@/lib/contracts';
import type { AdminGate } from '@/lib/recommendations';
import { bpsToPercentText, daysToSeconds, percentToBps } from '@/lib/views';

const preparePolicy = (body: PolicyPrepareRequest) => async () => (await api.post<AdminPrepareResponse>('/policy/prepare', body)).data;

function Row({ label, current, children }: { label: string; current: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 py-3 first:border-t-0">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-600">Current: {current}</p>
      </div>
      {children}
    </div>
  );
}

/** On-chain policy parameters (ADMIN): each change → POST /policy/prepare → wallet signature (docs/08 §3.10 §1). */
export function PolicyForm({ overview, gate }: { overview: TreasuryOverview; gate: AdminGate }) {
  const write = useAdminWrite();
  const [h, setH] = useState('');
  const [buffer, setBuffer] = useState('');
  const [exposure, setExposure] = useState('');
  const [error, setError] = useState<string | null>(null);
  const disabled = !gate.enabled || write.isPending;
  const input = 'w-32 rounded-md border border-slate-300 px-2 py-1 text-sm';
  const btn = 'rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50';

  function send(title: string, body: PolicyPrepareRequest | null, invalid: string) {
    if (!body) return setError(invalid);
    setError(null);
    write.mutate({ title, contract: 'PolicyEngine', functionName: body.fn, prepare: preparePolicy(body) }, { onError: (e) => setError(e.message) });
  }

  return (
    <section aria-label="Policy" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Policy (on-chain, ADMIN)</h2>
      <Row label="Safety horizon H (days, 1–90)" current={`${Math.floor(overview.policy.safetyHorizonSec / 86_400)} days`}>
        <input aria-label="Safety horizon days" className={input} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} />
        <GatedButton
          gate={gate}
          className={btn}
          disabled={disabled}
          onClick={() => {
            const sec = daysToSeconds(h);
            send('Set safety horizon', sec ? { fn: 'setSafetyHorizon', args: [sec] } : null, 'Enter a whole number of days');
          }}
        >
          Save
        </GatedButton>
      </Row>
      <Row label="Emergency buffer (USDC)" current={<AmountText value={overview.policy.emergencyBuffer} />}>
        <input aria-label="Emergency buffer" className={input} inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
        <GatedButton
          gate={gate}
          className={btn}
          disabled={disabled}
          onClick={() => {
            let amount: string | null = null;
            try {
              amount = parseUsdc(buffer, overview.asset.decimals).toString();
            } catch {
              amount = null;
            }
            send('Set emergency buffer', amount ? { fn: 'setEmergencyBuffer', args: [amount] } : null, 'Enter an amount, e.g. 10000');
          }}
        >
          Save
        </GatedButton>
      </Row>
      <Row label="Max exposure per adapter (%)" current={`${bpsToPercentText(overview.policy.maxExposureBps)}%`}>
        <input aria-label="Max exposure percent" className={input} inputMode="decimal" value={exposure} onChange={(e) => setExposure(e.target.value)} />
        <GatedButton
          gate={gate}
          className={btn}
          disabled={disabled}
          onClick={() => {
            const bps = percentToBps(exposure);
            send('Set max exposure', bps && bps <= 10_000 ? { fn: 'setMaxExposureBps', args: [bps] } : null, 'Enter a percentage between 0.01 and 100');
          }}
        >
          Save
        </GatedButton>
      </Row>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const STATUSES = ['ACTIVE', 'WITHDRAW_ONLY', 'NONE'] as const;

export function AdapterWhitelistTable({ overview, gate }: { overview: TreasuryOverview; gate: AdminGate }) {
  const write = useAdminWrite();
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Adapter whitelist" className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Adapter whitelist (R4)</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="py-2">Adapter</th>
            <th className="py-2 text-right">Balance</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {overview.adapters.map((a) => (
            <tr key={a.address} className="border-t border-slate-100">
              <td className="py-2">
                {a.name} <AddressChip address={a.address} />
              </td>
              <td className="py-2 text-right">
                <AmountText value={a.balance} />
              </td>
              <td className="py-2">
                <select
                  aria-label={`Status of ${a.name}`}
                  className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-50"
                  value={a.status}
                  disabled={!gate.enabled || write.isPending}
                  title={gate.reason ?? undefined}
                  onChange={(e) => {
                    const status = e.target.value as (typeof STATUSES)[number];
                    if (status === 'NONE' && a.balance !== '0') {
                      setError(`Withdraw the ${a.name} balance first: removal reverts with AdapterHasBalance.`);
                      return;
                    }
                    setError(null);
                    write.mutate(
                      {
                        title: `Set ${a.name} to ${status}`,
                        contract: 'PolicyEngine',
                        functionName: 'setAdapterStatus',
                        prepare: preparePolicy({ fn: 'setAdapterStatus', args: [a.address as Address, status] }),
                      },
                      { onError: (err) => setError(err.message) },
                    );
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const AGENT_ROLE = keccak256(toBytes('AGENT_ROLE'));
const TREASURY_ROLE = keccak256(toBytes('TREASURY_ROLE'));

/** Read-only role holders, each confirmed with an on-chain hasRole (docs/08 §3.10 §3). */
export function RolesPanel() {
  const t = contracts?.treasury;
  const r = contracts?.registry;
  const admin = deployment?.roles.admin;
  const agent = deployment?.roles.agent;
  const rows: { role: string; holder: Address | undefined; check: { address: Address; abi: unknown; role: `0x${string}` } | null }[] = [
    { role: 'ADMIN (DEFAULT_ADMIN_ROLE)', holder: admin, check: t && admin ? { address: t.address, abi: t.abi, role: DEFAULT_ADMIN_ROLE } : null },
    { role: 'AGENT_ROLE (Treasury)', holder: agent, check: t && agent ? { address: t.address, abi: t.abi, role: AGENT_ROLE } : null },
    { role: 'TREASURY_ROLE (Registry)', holder: t?.address, check: r && t ? { address: r.address, abi: r.abi, role: TREASURY_ROLE } : null },
  ];
  const reads = useReadContracts({
    contracts: rows.map((row) =>
      row.check && row.holder
        ? { address: row.check.address, abi: row.check.abi, functionName: 'hasRole', args: [row.check.role, row.holder], chainId: appChain.id }
        : { address: undefined, abi: [], functionName: 'hasRole' },
    ) as never,
    query: { enabled: Boolean(t && r) },
  });
  return (
    <section aria-label="Roles" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Roles (read-only)</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {rows.map((row, i) => {
          const ok = (reads.data as { result?: unknown }[] | undefined)?.[i]?.result;
          return (
            <li key={row.role} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-700">{row.role}</span>
              <span className="flex items-center gap-2">
                {row.holder ? <AddressChip address={row.holder} /> : '—'}
                {ok === true ? <StateChip state="VERIFIED" tone="success" /> : ok === false ? <StateChip state="NOT GRANTED" tone="danger" /> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-600">Keeper has no role: anyone may call pay() and enforceDeadlines().</p>
    </section>
  );
}
