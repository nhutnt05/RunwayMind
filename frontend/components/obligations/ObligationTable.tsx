'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { UpdateObligationRequestSchema } from '@runwaymind/shared';
import { AddressChip, AmountText, EmptyState, GatedButton, StateChip } from '@/components/ui';
import { useRegistryWrite } from '@/hooks/useRegistryWrite';
import { api, type ObligationItem, type PrepareTxResponse } from '@/lib/api';
import { countdown, dayLabel } from '@/lib/dashboard';
import { buildUpdateObligationRequest, intervalLabel, toEditValues, type ObligationEditValues } from '@/lib/obligationForm';
import type { AdminGate } from '@/lib/recommendations';

interface Props {
  obligations: ObligationItem[];
  chainTime: number;
  demoStartTime: number | null;
  gate: AdminGate;
}

function recurrenceText(o: ObligationItem): string {
  const base = intervalLabel(o.interval);
  if (o.interval === 0) return base;
  const total = o.maxOccurrences === 0 ? '∞' : String(o.maxOccurrences);
  return `${base} · ${o.paidOccurrences}/${total} paid`;
}

function editOriginal(o: ObligationItem) {
  return {
    recipient: o.recipient,
    amount: o.amount,
    nextDueDate: o.nextDueDate,
    label: o.metadata?.label ?? null,
    notes: o.metadata?.notes ?? null,
  };
}

/** docs/08 §3.3 ObligationTable: table ≥ md, stacked cards < md (docs/08 §9). */
export function ObligationTable({ obligations, chainTime, demoStartTime, gate }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const write = useRegistryWrite();

  if (obligations.length === 0) {
    return <EmptyState title="No obligations yet" description="No obligations yet — add payroll to start the Cash Ladder." />;
  }

  function cancel(o: ObligationItem) {
    const name = o.metadata?.label ?? `#${o.id}`;
    if (!window.confirm(`Cancel obligation ${name}? This is recorded on-chain.`)) return;
    write.mutate({
      title: `Cancel obligation ${name}`,
      kind: 'CANCEL_OBLIGATION',
      functionName: 'cancelObligation',
      prepare: () => api.post<PrepareTxResponse>(`/obligations/${encodeURIComponent(o.id)}/cancel`),
    });
  }

  const sorted = [...obligations].sort((a, b) => a.nextDueDate - b.nextDueDate);

  const actions = (o: ObligationItem) =>
    o.status === 'ACTIVE' ? (
      <div className="flex gap-2">
        <GatedButton
          gate={gate}
          disabled={write.isPending}
          onClick={() => setEditing(editing === o.id ? null : o.id)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
          aria-label={`Edit obligation ${o.metadata?.label ?? o.id}`}
        >
          Edit
        </GatedButton>
        <GatedButton
          gate={gate}
          disabled={write.isPending}
          onClick={() => cancel(o)}
          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
          aria-label={`Cancel obligation ${o.metadata?.label ?? o.id}`}
        >
          Cancel
        </GatedButton>
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      {write.error ? (
        <p role="alert" className="text-sm text-red-800">
          {write.error.message}
        </p>
      ) : null}

      {/* ≥ md: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Obligations</caption>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">ID</th>
              <th scope="col" className="px-3 py-2">Label</th>
              <th scope="col" className="px-3 py-2">Category</th>
              <th scope="col" className="px-3 py-2">Recipient</th>
              <th scope="col" className="px-3 py-2 text-right">Amount</th>
              <th scope="col" className="px-3 py-2">Next due</th>
              <th scope="col" className="px-3 py-2">Withdrawal deadline</th>
              <th scope="col" className="px-3 py-2">Recurrence</th>
              <th scope="col" className="px-3 py-2">State</th>
              <th scope="col" className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((o) => (
              <FragmentRow key={o.id} colSpan={10} editor={editing === o.id ? <EditRow o={o} onDone={() => setEditing(null)} /> : null}>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">#{o.id}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{o.metadata?.label ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{o.category.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2"><AddressChip address={o.recipient} /></td>
                <td className="px-3 py-2 text-right"><AmountText value={o.amount} /></td>
                <td className="px-3 py-2 text-xs">
                  {dayLabel(o.nextDueDate, demoStartTime)}
                  {o.status === 'ACTIVE' ? <span className="block text-slate-500">{countdown(o.nextDueDate, chainTime)}</span> : null}
                </td>
                <td className="px-3 py-2 text-xs">{o.status === 'ACTIVE' ? dayLabel(o.withdrawalDeadline, demoStartTime) : '—'}</td>
                <td className="px-3 py-2 text-xs">{recurrenceText(o)}</td>
                <td className="px-3 py-2"><StateChip state={o.derivedState} /></td>
                <td className="px-3 py-2">{actions(o)}</td>
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </div>

      {/* < md: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {sorted.map((o) => (
          <li key={o.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{o.metadata?.label ?? `Obligation #${o.id}`}</p>
                <p className="text-xs text-slate-600">
                  #{o.id} · {o.category.replace(/_/g, ' ')} · {recurrenceText(o)}
                </p>
              </div>
              <StateChip state={o.derivedState} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-500">Amount</dt>
              <dd><AmountText value={o.amount} /></dd>
              <dt className="text-slate-500">Recipient</dt>
              <dd><AddressChip address={o.recipient} /></dd>
              <dt className="text-slate-500">Next due</dt>
              <dd>{dayLabel(o.nextDueDate, demoStartTime)} ({countdown(o.nextDueDate, chainTime)})</dd>
              <dt className="text-slate-500">Withdraw by</dt>
              <dd>{dayLabel(o.withdrawalDeadline, demoStartTime)}</dd>
            </dl>
            <div className="mt-2">{actions(o)}</div>
            {editing === o.id ? (
              <div className="mt-3">
                <EditRow o={o} onDone={() => setEditing(null)} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FragmentRow({ children, editor, colSpan }: { children: ReactNode; editor: ReactNode; colSpan: number }) {
  return (
    <>
      <tr className="align-top">{children}</tr>
      {editor ? (
        <tr>
          <td colSpan={colSpan} className="bg-slate-50 px-3 py-3">
            {editor}
          </td>
        </tr>
      ) : null}
    </>
  );
}

const INPUT = 'mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200';

/** Edit → `PATCH /obligations/:id` (only changed fields; label/notes-only changes need no signature). */
function EditRow({ o, onDone }: { o: ObligationItem; onDone: () => void }) {
  const original = editOriginal(o);
  const [values, setValues] = useState<ObligationEditValues>(() => toEditValues(original));
  const [error, setError] = useState<string | null>(null);
  const write = useRegistryWrite();
  const set = (k: keyof ObligationEditValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let body;
    try {
      body = UpdateObligationRequestSchema.parse(buildUpdateObligationRequest(original, values));
    } catch (err) {
      const issues = (err as { issues?: { message: string }[] }).issues;
      setError(issues?.map((i) => i.message).join('; ') ?? (err as Error).message);
      return;
    }
    try {
      await write.mutateAsync({
        title: `Update obligation ${o.metadata?.label ?? `#${o.id}`}`,
        kind: 'UPDATE_OBLIGATION',
        functionName: 'updateObligation',
        prepare: () =>
          api.patchValidated<typeof UpdateObligationRequestSchema, PrepareTxResponse>(
            `/obligations/${encodeURIComponent(o.id)}`,
            UpdateObligationRequestSchema,
            body,
          ),
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const id = (k: string) => `edit-${o.id}-${k}`;
  return (
    <form onSubmit={submit} aria-label={`Edit obligation ${o.id}`} className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <div className="md:col-span-2">
        <label htmlFor={id('recipient')} className="text-xs font-medium text-slate-700">Recipient</label>
        <input id={id('recipient')} className={`${INPUT} font-mono`} value={values.recipient} onChange={set('recipient')} />
      </div>
      <div>
        <label htmlFor={id('amount')} className="text-xs font-medium text-slate-700">Amount (USDC)</label>
        <input id={id('amount')} inputMode="decimal" className={INPUT} value={values.amount} onChange={set('amount')} />
      </div>
      <div>
        <label htmlFor={id('due')} className="text-xs font-medium text-slate-700">Next due (UTC)</label>
        <input id={id('due')} type="date" className={INPUT} value={values.nextDueDate} onChange={set('nextDueDate')} />
      </div>
      <div>
        <label htmlFor={id('label')} className="text-xs font-medium text-slate-700">Label</label>
        <input id={id('label')} className={INPUT} value={values.label} onChange={set('label')} />
      </div>
      <div className="md:col-span-5">
        <label htmlFor={id('notes')} className="text-xs font-medium text-slate-700">Notes</label>
        <input id={id('notes')} className={INPUT} value={values.notes} onChange={set('notes')} />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-800 md:col-span-5">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-5">
        <button
          type="submit"
          disabled={write.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {write.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100">
          Close
        </button>
      </div>
    </form>
  );
}
