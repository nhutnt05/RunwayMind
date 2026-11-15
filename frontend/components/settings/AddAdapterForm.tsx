'use client';

// Settings → Adapter whitelist → "Add adapter": PolicyEngine.setAdapterStatus(newAdapter, ACTIVE | WITHDRAW_ONLY),
// signed by the ADMIN wallet. The address is checked on-chain first (lib/adapterCheck.ts); the backend repeats the
// same check in POST /policy/prepare, and the contract itself rejects a different asset or a full list.
import { useState } from 'react';
import { useReadContracts } from 'wagmi';
import { getAddress, isAddress, type Address } from 'viem';
import { vaultAdapterAbi } from '@runwaymind/shared/abi';
import { GatedButton } from '@/components/ui';
import { AlertTriangleIcon, CheckCircleIcon, Spinner } from '@/components/ui/icons';
import { useAdminWrite } from '@/hooks/useAdminWrite';
import { api, type AdminPrepareResponse, type TreasuryOverview } from '@/lib/api';
import { ADAPTER_PROBE_FUNCTIONS, MAX_ADAPTERS, evaluateProbe, precheckAdapter, type AdapterCheck } from '@/lib/adapterCheck';
import { appChain } from '@/lib/chains';
import type { AdminGate } from '@/lib/recommendations';

type InitialStatus = 'ACTIVE' | 'WITHDRAW_ONLY';

/** Collapsed by default: a "+ Add adapter" button opens the form; Cancel closes it and clears the input. */
export function AddAdapterForm({ overview, gate }: { overview: TreasuryOverview; gate: AdminGate }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={false}
          aria-controls="add-adapter-form"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-400 px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-slate-500 hover:bg-slate-50"
        >
          <span aria-hidden className="text-base leading-none">+</span>
          Add adapter
        </button>
        <span className="text-xs text-slate-500">
          {overview.adapters.length} of {MAX_ADAPTERS} used
        </span>
      </div>
    );
  }
  return <AddAdapterPanel overview={overview} gate={gate} onClose={() => setOpen(false)} />;
}

function AddAdapterPanel({ overview, gate, onClose }: { overview: TreasuryOverview; gate: AdminGate; onClose: () => void }) {
  const write = useAdminWrite();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<InitialStatus>('ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const listed = overview.adapters.map((a) => a.address);
  const pre = precheckAdapter(text, { listed, treasury: overview.treasury });
  const candidate: Address | null = pre === null && isAddress(text.trim(), { strict: false }) ? getAddress(text.trim()) : null;

  const probe = useReadContracts({
    contracts: ADAPTER_PROBE_FUNCTIONS.map((functionName) => ({
      address: (candidate ?? overview.treasury) as Address,
      abi: vaultAdapterAbi,
      functionName,
      chainId: appChain.id,
    })),
    allowFailure: true,
    query: { enabled: candidate !== null, staleTime: 30_000 },
  });

  let check: AdapterCheck;
  if (pre) check = pre;
  else if (probe.isError) check = { state: 'failed', name: null, problems: ['Could not read the chain. Try again in a moment.'] };
  else if (!probe.data || probe.isFetching) check = { state: 'checking' };
  else check = evaluateProbe(probe.data, { treasury: overview.treasury, asset: overview.asset.address, assetSymbol: overview.asset.symbol });

  const full = listed.length >= MAX_ADAPTERS;

  const submit = () => {
    if (check.state !== 'ok' || !candidate) return;
    const name = check.name;
    setError(null);
    setDone(null);
    write.mutate(
      {
        title: `Add ${name} to the whitelist (${status.replace('_', ' ')})`,
        contract: 'PolicyEngine',
        functionName: 'setAdapterStatus',
        prepare: async () => (await api.post<AdminPrepareResponse>('/policy/prepare', { fn: 'setAdapterStatus', args: [candidate, status] })).data,
      },
      {
        onSuccess: () => {
          setDone(`${name} was submitted. It appears in the table once the transaction is confirmed.`);
          setText('');
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <form
      id="add-adapter-form"
      aria-labelledby="add-adapter-title"
      className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="add-adapter-title" className="text-sm font-semibold text-slate-900">
          Add adapter
        </h3>
        <span className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {listed.length} of {MAX_ADAPTERS} used
          </span>
          <button
            type="button"
            aria-expanded={true}
            aria-controls="add-adapter-form"
            onClick={onClose}
            disabled={write.isPending}
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-600">Paste the address of a deployed vault adapter. It is checked on-chain before you can sign.</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="add-adapter-address" className="block text-xs font-medium text-slate-700">
            Adapter address
          </label>
          <input
            id="add-adapter-address"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(null);
              setError(null);
            }}
            placeholder="0x…"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            disabled={full}
            aria-describedby="add-adapter-check"
            aria-invalid={check.state === 'invalid' || check.state === 'failed'}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="add-adapter-status" className="block text-xs font-medium text-slate-700">
            Start as
          </label>
          <select
            id="add-adapter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as InitialStatus)}
            className="mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="ACTIVE">Active (can receive investments)</option>
            <option value="WITHDRAW_ONLY">Withdraw only</option>
          </select>
        </div>
        <GatedButton
          gate={gate}
          type="submit"
          disabled={check.state !== 'ok' || write.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {write.isPending ? 'Waiting for wallet…' : 'Add adapter'}
        </GatedButton>
      </div>

      <div id="add-adapter-check" aria-live="polite" className="mt-2 text-xs" data-testid="add-adapter-check">
        {full && check.state === 'empty' ? (
          <p className="text-slate-600">The whitelist is full (max {MAX_ADAPTERS}). Remove an adapter to add another.</p>
        ) : check.state === 'invalid' ? (
          <p className="text-red-800">{check.message}</p>
        ) : check.state === 'checking' ? (
          <p className="flex items-center gap-2 text-slate-600">
            <Spinner className="h-3 w-3" /> Checking the contract on-chain…
          </p>
        ) : check.state === 'failed' ? (
          <div className="flex items-start gap-2 text-red-800">
            <AlertTriangleIcon className="mt-px h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Cannot add {check.name ? `"${check.name}"` : 'this address'}:</p>
              <ul className="mt-0.5 list-disc pl-4">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : check.state === 'ok' ? (
          <p className="flex items-center gap-2 text-emerald-800">
            <CheckCircleIcon className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">{check.name}</span>: compatible vault adapter for {overview.asset.symbol}; withdrawals return to this
              Treasury.
            </span>
          </p>
        ) : null}
        {done ? <p className="mt-1 text-emerald-800">{done}</p> : null}
        {error ? (
          <p role="alert" className="mt-1 font-semibold text-red-800">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
