'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { CategorySchema, CreateObligationRequestSchema, type CreateObligationRequest } from '@runwaymind/shared';
import { useRegistryWrite } from '@/hooks/useRegistryWrite';
import { api, type PrepareTxResponse } from '@/lib/api';
import {
  DEFAULT_OBLIGATION_FORM,
  RECURRENCE_OPTIONS,
  buildCreateObligationRequest,
  createObligationFormSchema,
  type ObligationFormValues,
} from '@/lib/obligationForm';
import type { AdminGate } from '@/lib/recommendations';

const INPUT =
  'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200';
const LABEL = 'block text-sm font-medium text-slate-700';

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-1 text-xs text-red-700">
      {message}
    </p>
  ) : null;
}

/**
 * docs/08 §3.3 CreateObligationForm. Submit → `POST /obligations` (prepare + simulation) → wallet sign →
 * `POST /transactions` → receipt → invalidate (see useRegistryWrite).
 */
export function CreateObligationForm({ chainTime, gate }: { chainTime: number | null; gate: AdminGate }) {
  const schema = useMemo(() => createObligationFormSchema({ chainTime }), [chainTime]);
  const write = useRegistryWrite();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ObligationFormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULT_OBLIGATION_FORM, mode: 'onBlur' });

  const recurrence = watch('recurrence');

  async function onSubmit(values: ObligationFormValues) {
    const request: CreateObligationRequest = buildCreateObligationRequest(values);
    await write.mutateAsync({
      title: `Create obligation "${request.label}"`,
      kind: 'CREATE_OBLIGATION',
      functionName: 'createObligation',
      prepare: () => api.postValidated<typeof CreateObligationRequestSchema, PrepareTxResponse>('/obligations', CreateObligationRequestSchema, request),
    });
    reset(DEFAULT_OBLIGATION_FORM);
  }

  const busy = isSubmitting || write.isPending;
  const err = (name: keyof ObligationFormValues) => errors[name]?.message;
  const aria = (name: keyof ObligationFormValues) =>
    err(name) ? { 'aria-invalid': true as const, 'aria-describedby': `ob-${name}-error` } : {};

  return (
    <form
      onSubmit={handleSubmit((v) => onSubmit(v).catch(() => undefined))}
      noValidate
      aria-label="Create obligation"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">Add obligation</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="ob-label" className={LABEL}>
            Label
          </label>
          <input id="ob-label" className={INPUT} placeholder="December payroll" {...register('label')} {...aria('label')} />
          <FieldError id="ob-label-error" message={err('label')} />
        </div>
        <div>
          <label htmlFor="ob-category" className={LABEL}>
            Category
          </label>
          <select id="ob-category" className={INPUT} {...register('category')}>
            {CategorySchema.options.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor="ob-recipient" className={LABEL}>
            Recipient address
          </label>
          <input
            id="ob-recipient"
            className={`${INPUT} font-mono`}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            {...register('recipient')}
            {...aria('recipient')}
          />
          <FieldError id="ob-recipient-error" message={err('recipient')} />
        </div>
        <div>
          <label htmlFor="ob-amount" className={LABEL}>
            Amount (USDC)
          </label>
          <input id="ob-amount" inputMode="decimal" className={INPUT} placeholder="20,000.00" {...register('amount')} {...aria('amount')} />
          <FieldError id="ob-amount-error" message={err('amount')} />
        </div>
        <div>
          <label htmlFor="ob-due" className={LABEL}>
            First due date <span className="font-normal text-slate-500">(00:00 UTC)</span>
          </label>
          <input id="ob-due" type="date" className={INPUT} {...register('firstDueDate')} {...aria('firstDueDate')} />
          <FieldError id="ob-firstDueDate-error" message={err('firstDueDate')} />
        </div>
        <div>
          <label htmlFor="ob-recurrence" className={LABEL}>
            Recurrence
          </label>
          <select id="ob-recurrence" className={INPUT} {...register('recurrence')}>
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {recurrence === 'EVERY_N_DAYS' ? (
          <div>
            <label htmlFor="ob-every" className={LABEL}>
              Every N days
            </label>
            <input id="ob-every" inputMode="numeric" className={INPUT} placeholder="14" {...register('everyNDays')} {...aria('everyNDays')} />
            <FieldError id="ob-everyNDays-error" message={err('everyNDays')} />
          </div>
        ) : null}
        {recurrence !== 'NONE' ? (
          <div>
            <label htmlFor="ob-occurrences" className={LABEL}>
              Occurrences <span className="font-normal text-slate-500">(blank = unlimited, else ≥ 2)</span>
            </label>
            <input
              id="ob-occurrences"
              inputMode="numeric"
              className={INPUT}
              placeholder="unlimited"
              {...register('occurrences')}
              {...aria('occurrences')}
            />
            <FieldError id="ob-occurrences-error" message={err('occurrences')} />
          </div>
        ) : null}
        <div className="md:col-span-2">
          <label htmlFor="ob-notes" className={LABEL}>
            Notes <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea id="ob-notes" rows={2} className={INPUT} {...register('notes')} {...aria('notes')} />
          <FieldError id="ob-notes-error" message={err('notes')} />
        </div>
      </div>
      {recurrence === 'MONTHLY_30D' ? (
        <p className="mt-3 text-xs text-amber-800">Monthly is approximated as a fixed 30-day interval.</p>
      ) : null}
      {write.error ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {write.error.message}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!gate.enabled || busy}
          title={gate.reason ?? undefined}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Create & sign'}
        </button>
        {gate.reason ? <span className="text-xs text-slate-600">{gate.reason}</span> : null}
      </div>
    </form>
  );
}
