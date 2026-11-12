'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { parseUsdc } from '@runwaymind/shared';
import { vaultAdapterAbi } from '@runwaymind/shared/abi';
import { AddressChip, AmountText, StateChip } from '@/components/ui';
import { useAdminWrite, useVaultAgentAction } from '@/hooks/useAdminWrite';
import { api, ApiError, type TreasuryOverview, type VaultActionResponse } from '@/lib/api';
import { appChain } from '@/lib/chains';
import type { AdminGate } from '@/lib/recommendations';
import { blockedLabel, bpsToPercentText, type Headroom } from '@/lib/views';

type Dialog = 'withdraw' | 'withdrawAll' | 'invest' | null;
type ExecuteVia = 'AGENT' | 'ADMIN_WALLET';

/** 409 POLICY_VIOLATION carries { error, rule } (docs/07 §5.6) → "Blocked by R1 Reserve Ratio: …". */
function describeApiError(e: unknown): string {
  if (e instanceof ApiError && e.code === 'POLICY_VIOLATION') {
    return blockedLabel((e.details as { error?: Parameters<typeof blockedLabel>[0] } | undefined)?.error ?? null);
  }
  return e instanceof Error ? e.message : String(e);
}

export function AdapterCard({
  adapter,
  headroom,
  gate,
}: {
  adapter: TreasuryOverview['adapters'][number];
  headroom: Headroom;
  gate: AdminGate;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [amountText, setAmountText] = useState('');
  const [via, setVia] = useState<ExecuteVia>('AGENT');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string; decisionId?: string } | null>(null);
  const wallet = useAdminWrite();
  const agent = useVaultAgentAction();
  const busy = wallet.isPending || agent.isPending;

  const liquidity = useReadContract({
    address: adapter.address as Address,
    abi: vaultAdapterAbi,
    functionName: 'availableLiquidity',
    chainId: appChain.id,
    query: { refetchInterval: 10_000 },
  });

  const open = (d: Dialog) => {
    setDialog(d);
    setNotice(null);
    setAmountText('');
  };

  async function submit() {
    const kind = dialog === 'invest' ? 'investments' : 'withdrawals';
    let amount: string;
    try {
      amount = dialog === 'withdrawAll' ? 'MAX' : parseUsdc(amountText).toString();
      if (amount !== 'MAX' && BigInt(amount) <= 0n) throw new Error('Amount must be greater than 0');
    } catch (e) {
      setNotice({ tone: 'error', text: (e as Error).message });
      return;
    }
    try {
      if (via === 'AGENT') {
        const res = await agent.mutateAsync({ kind, adapter: adapter.address as Address, amount });
        setNotice({ tone: 'ok', text: `Queued for the agent (${res.decision?.status ?? 'APPROVED'}).`, ...(res.decision ? { decisionId: res.decision.id } : {}) });
      } else {
        await wallet.mutateAsync({
          title: dialog === 'invest' ? 'Invest' : 'Withdraw',
          contract: 'Treasury',
          functionName: dialog === 'invest' ? 'invest' : 'withdraw',
          prepare: async () =>
            (await api.post<VaultActionResponse>(`/vault/${kind}`, { adapter: adapter.address, amount, executeVia: 'ADMIN_WALLET' })).data,
        });
        setNotice({ tone: 'ok', text: 'Confirmed on-chain.' });
      }
      setDialog(null);
      setAmountText('');
    } catch (e) {
      setNotice({ tone: 'error', text: describeApiError(e) });
    }
  }

  const btn = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  const disabled = !gate.enabled || busy;

  return (
    <article aria-label={adapter.name} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{adapter.name}</h3>
          <AddressChip address={adapter.address} />
        </div>
        <div className="flex gap-1">
          <StateChip state={adapter.status} />
          {adapter.paused ? <StateChip state="PAUSED" tone="danger" /> : null}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-600">Balance</dt>
          <dd className="font-semibold">
            <AmountText value={adapter.balance} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">APY</dt>
          <dd className="font-semibold tabular-nums">{bpsToPercentText(adapter.apyBps)}%</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Utilization</dt>
          <dd className="font-semibold tabular-nums">{bpsToPercentText(adapter.utilizationBps)}%</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Liquidity available</dt>
          <dd className="font-semibold">{liquidity.data !== undefined ? <AmountText value={liquidity.data as bigint} /> : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Risk score</dt>
          <dd className="font-semibold tabular-nums">{adapter.riskScore} / 100</dd>
        </div>
      </dl>

      <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
        <p className="text-sm font-semibold text-slate-900">
          Max investable now: <AmountText value={headroom.maxInvestable} />
        </p>
        <p>
          R1 reserve headroom <AmountText value={headroom.r1} symbol={null} /> · R3 exposure headroom <AmountText value={headroom.r3} symbol={null} />
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${btn} border border-slate-300`} disabled={disabled} title={gate.reason ?? undefined} onClick={() => open('withdraw')}>
          Withdraw
        </button>
        <button type="button" className={`${btn} border border-slate-300`} disabled={disabled || adapter.balance === '0'} title={gate.reason ?? undefined} onClick={() => open('withdrawAll')}>
          Withdraw all
        </button>
        <button type="button" className={`${btn} bg-slate-900 text-white`} disabled={disabled || adapter.status !== 'ACTIVE'} title={gate.reason ?? undefined} onClick={() => open('invest')}>
          Invest
        </button>
      </div>

      {dialog ? (
        <form
          aria-label={`${dialog} form`}
          className="mt-3 space-y-2 rounded-md border border-slate-200 p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="font-semibold">{dialog === 'invest' ? 'Invest into' : dialog === 'withdrawAll' ? 'Withdraw everything from' : 'Withdraw from'} {adapter.name}</p>
          {dialog !== 'withdrawAll' ? (
            <label className="block">
              Amount (USDC)
              <input
                inputMode="decimal"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder={dialog === 'invest' ? 'e.g. 70000' : 'e.g. 20000'}
              />
            </label>
          ) : null}
          <fieldset className="flex flex-wrap gap-4">
            <legend className="sr-only">Execute via</legend>
            <label className="flex items-center gap-1">
              <input type="radio" name={`via-${adapter.address}`} checked={via === 'AGENT'} onChange={() => setVia('AGENT')} /> Agent key (no signature)
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name={`via-${adapter.address}`} checked={via === 'ADMIN_WALLET'} onChange={() => setVia('ADMIN_WALLET')} /> My admin wallet
            </label>
          </fieldset>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`${btn} bg-slate-900 text-white`}>
              {busy ? 'Working…' : 'Confirm'}
            </button>
            <button type="button" className={`${btn} border border-slate-300`} onClick={() => setDialog(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${notice.tone === 'error' ? 'font-semibold text-red-800' : 'text-emerald-800'}`}>
          {notice.text}{' '}
          {notice.decisionId ? (
            <Link className="underline" href="/agent">
              Track on the Agent page
            </Link>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}
