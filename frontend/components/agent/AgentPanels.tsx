'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AgentSettingsUpdateSchema, formatUsdc } from '@runwaymind/shared';
import { AddressChip, AmountText, EmptyState, GatedButton, SnowtraceLink, StateChip } from '@/components/ui';
import { api, type AgentSettingsJson, type KeeperStatusJson } from '@/lib/api';
import type { AdminGate } from '@/lib/recommendations';
import { activityError, blockedLabel, filterActivity, isBlocked, type ActivityItemJson, type ActivityType } from '@/lib/views';

const ago = (at: number) => new Date(at * 1000).toLocaleString();

/** APPROVE ↔ AUTO with a confirm dialog (docs/08 §3.8); PUT /agent/settings audits MODE_CHANGED. */
export function ModeSwitch({ settings, gate }: { settings: AgentSettingsJson | undefined; gate: AdminGate }) {
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (mode: 'APPROVE' | 'AUTO') => api.putValidated('/agent/settings', AgentSettingsUpdateSchema, { mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent'] }),
  });
  const mode = settings?.mode;
  const next = mode === 'AUTO' ? 'APPROVE' : 'AUTO';
  return (
    <section aria-label="Agent mode" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Mode</h2>
        {mode ? <StateChip state={mode} tone={mode === 'AUTO' ? 'warning' : 'info'} /> : null}
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {mode === 'AUTO'
          ? 'AUTO: the agent executes its own decisions. On-chain rules R1–R6 still apply.'
          : 'APPROVE: every recommendation waits for an ADMIN approval.'}
      </p>
      <GatedButton
        gate={gate}
        disabled={!mode || change.isPending}
        className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
        onClick={() => {
          const msg =
            next === 'AUTO'
              ? 'Switch to AUTO mode? The agent will invest and withdraw without asking. Contract policy still enforces R1–R6.'
              : 'Switch back to APPROVE mode? New recommendations will wait for approval.';
          if (window.confirm(msg)) change.mutate(next);
        }}
      >
        Switch to {next}
      </GatedButton>
      {change.error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {(change.error as Error).message}
        </p>
      ) : null}
    </section>
  );
}

export function KeeperStatusCard({ status, gate }: { status: KeeperStatusJson | undefined; gate: AdminGate }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post('/keeper/run'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['keeper'] }),
  });
  return (
    <section aria-label="Keeper status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Keeper</h2>
        <StateChip state={status?.enabled ? 'ENABLED' : 'DISABLED'} tone={status?.enabled ? 'success' : 'neutral'} />
      </div>
      {status?.keeperAddress ? (
        <p className="mt-1 flex items-center gap-2 text-xs">
          <AddressChip address={status.keeperAddress} />
          {status.avaxBalance ? <span>{formatUsdc(BigInt(status.avaxBalance), 18, 4)} AVAX</span> : null}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-slate-600">
        Last run: {status?.lastRunAt ? ago(status.lastRunAt) : '—'} · next: {status?.nextRunAt ? ago(status.nextRunAt) : '—'}
      </p>
      {status?.lastResult ? (
        <p className="text-xs text-slate-600">
          Paid {status.lastResult.paidIds.length ? status.lastResult.paidIds.map((i) => `#${i}`).join(', ') : 'nothing'} ·{' '}
          {status.lastResult.enforced ? 'deadlines enforced' : 'no shortfall'}
        </p>
      ) : null}
      {status?.lastError ? (
        <p role="alert" className="text-xs text-red-800">
          {status.lastError}
        </p>
      ) : null}
      <GatedButton
        gate={gate}
        disabled={!status?.enabled || run.isPending}
        className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
        onClick={() => run.mutate()}
      >
        {run.isPending ? 'Running…' : 'Run keeper now'}
      </GatedButton>
    </section>
  );
}

function ActivityRow({ item }: { item: ActivityItemJson }) {
  const blocked = isBlocked(item);
  const d = item.data as Record<string, unknown>;
  const err = activityError(item);
  const explanation = d.explanation as { headline?: string } | null | undefined;
  let title: string;
  if (item.type === 'DECISION') title = explanation?.headline ?? `${String(d.action).replace(/_/g, ' ')}`;
  else if (item.type === 'ACTION') title = `Transaction: ${String(d.functionName)}`;
  else title = 'Keeper run';
  const txHash = (d.txHash as string | null | undefined) ?? undefined;
  const keeperTxs = (d.txHashes as string[] | undefined) ?? [];
  return (
    <li data-blocked={blocked || undefined} className={`rounded-lg border p-3 ${blocked ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{item.type.replace('_', ' ')}</span>
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">{title}</span>
        {typeof d.status === 'string' ? <StateChip state={d.status} /> : null}
        <span className="text-xs text-slate-500">{ago(item.at)}</span>
      </div>
      {item.type === 'DECISION' && typeof d.amount === 'string' ? (
        <p className="mt-1 text-xs text-slate-700">
          <AmountText value={d.amount} /> · {String(d.reasonCode).replace(/_/g, ' ')} · {String(d.mode)}
        </p>
      ) : null}
      {blocked ? <p className="mt-1 text-xs font-semibold text-red-800">{blockedLabel(err)}</p> : err ? <p className="mt-1 text-xs text-red-800">{err.name}</p> : null}
      {item.type === 'KEEPER_RUN' ? (
        <p className="mt-1 text-xs text-slate-700">
          Paid {(d.paidIds as string[]).length ? (d.paidIds as string[]).map((i) => `#${i}`).join(', ') : 'nothing'}
          {d.enforced ? ' · deadlines enforced' : ''}
        </p>
      ) : null}
      {[txHash, ...keeperTxs].filter(Boolean).map((h) => (
        <p key={h} className="mt-1 text-xs">
          <SnowtraceLink kind="tx" value={h!}>
            {h!.slice(0, 10)}… on Snowtrace
          </SnowtraceLink>
        </p>
      ))}
    </li>
  );
}

const FILTERS: (ActivityType | 'ALL')[] = ['ALL', 'DECISION', 'ACTION', 'KEEPER_RUN'];

export function ActivityTimeline({ items }: { items: ActivityItemJson[] }) {
  const [filter, setFilter] = useState<ActivityType | 'ALL'>('ALL');
  const shown = filterActivity(items, filter);
  return (
    <section aria-label="Activity timeline" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
        <div role="group" aria-label="Filter activity" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 text-xs ${filter === f ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No agent activity yet" description="Decisions appear here after the first agent tick." />
      ) : (
        <ol className="space-y-2">
          {shown.map((i) => (
            <ActivityRow key={`${i.type}-${i.id}`} item={i} />
          ))}
        </ol>
      )}
    </section>
  );
}
