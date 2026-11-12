'use client';

import { useState } from 'react';
import type { TransactionKind, TransactionStatus } from '@runwaymind/shared';
import { AddressChip, EmptyState, ErrorState, PageHeader, Skeleton, SnowtraceLink, StateChip, TxStatusBadge } from '@/components/ui';
import { useKeeperStatus, useTransactions } from '@/hooks/useApiQueries';
import { deployment } from '@/lib/contracts';
import { formatDecodedError } from '@/lib/preparedTx';
import { txRole, type RoleBadge } from '@/lib/views';

const KINDS: TransactionKind[] = [
  'CREATE_OBLIGATION',
  'UPDATE_OBLIGATION',
  'CANCEL_OBLIGATION',
  'INVEST',
  'WITHDRAW',
  'PAY',
  'ENFORCE_DEADLINES',
  'TRIP_BREAKER',
  'RESET_BREAKER',
  'SET_POLICY',
  'SET_ADAPTER_STATUS',
  'ADVANCE_TIME',
  'POOL_CONTROL',
  'OTHER',
];
const STATUSES: TransactionStatus[] = ['PENDING', 'CONFIRMED', 'REVERTED', 'FAILED', 'DROPPED'];
const ROLE_TONE: Record<RoleBadge, 'info' | 'warning' | 'success' | 'neutral'> = { ADMIN: 'info', AGENT: 'warning', KEEPER: 'success', OTHER: 'neutral' };

export default function TransactionsPage() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  // Cursor stack: [undefined, cursorOfPage2, cursorOfPage3, …]
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const txs = useTransactions({ kind: kind || undefined, status: status || undefined, cursor });
  const keeper = useKeeperStatus();
  const roles = { admin: deployment?.roles.admin, agent: deployment?.roles.agent, keeper: keeper.data?.data.keeperAddress };
  const items = txs.data?.data ?? [];
  const nextCursor = txs.data?.meta.nextCursor ?? null;
  const resetPaging = () => setCursors([null]);

  return (
    <>
      <PageHeader title="Transactions" description="Every Treasury, registry, policy and demo transaction with role, status and decoded events." />

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          Kind
          <select
            className="rounded-md border border-slate-300 px-2 py-1"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              resetPaging();
            }}
          >
            <option value="">All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Status
          <select
            className="rounded-md border border-slate-300 px-2 py-1"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPaging();
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {txs.isError && !txs.data ? (
        <ErrorState title="Could not load transactions" message={(txs.error as Error).message} onRetry={() => void txs.refetch()} />
      ) : !txs.data ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No transactions" description="Transactions appear here once they are sent or indexed." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-600">
              <tr>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Block</th>
                <th className="px-4 py-2">Events / error</th>
                <th className="px-4 py-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const role = txRole(t.from, roles);
                const failed = t.status === 'REVERTED' || t.status === 'FAILED';
                return (
                  <tr key={t.hash} className={`border-t border-slate-100 ${failed ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-2 font-medium">{t.kind.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <StateChip state={role} tone={ROLE_TONE[role]} />
                        <AddressChip address={t.from} />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <TxStatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-2 tabular-nums">{t.blockNumber ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {t.error ? <span className="font-semibold text-red-800">{formatDecodedError(t.error)}</span> : t.decodedEvents.map((e) => e.name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <SnowtraceLink kind="tx" value={t.hash}>
                        {t.hash.slice(0, 10)}…
                      </SnowtraceLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-between border-t border-slate-100 p-3 text-sm">
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
              Previous
            </button>
            <span className="text-slate-600">Page {cursors.length}</span>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50" disabled={!nextCursor} onClick={() => setCursors((c) => [...c, nextCursor])}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
