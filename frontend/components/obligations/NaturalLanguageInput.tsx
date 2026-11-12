'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreateObligationRequestSchema,
  ParseObligationsRequestSchema,
  formatUsdcPlain,
  parseUsdc,
} from '@runwaymind/shared';
import { useRegistryWrite } from '@/hooks/useRegistryWrite';
import { api, type PrepareTxResponse } from '@/lib/api';
import { intervalLabel } from '@/lib/obligationForm';
import { GatedButton } from '@/components/ui';
import type { AdminGate } from '@/lib/recommendations';
import { WARNING_TEXT, draftDueDate, draftToCreateRequest, type DraftJson } from '@/lib/insights';

interface ParseResponse {
  drafts: DraftJson[];
  needsClarification: string[];
  llm: { provider: string; latencyMs: number };
}

type Row = DraftJson & { amountText: string; dateText: string; dateEdited: boolean; state: 'review' | 'signing' | 'done' | 'error'; error?: string };

const isoDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * docs/08 §3.3: textarea + VI/EN toggle → POST /obligations/parse → DraftReviewList (editable, warnings) →
 * "Confirm & sign" per draft (POST /obligations with nlDraftId → wallet). The LLM only suggests; every draft is
 * re-validated by the API, simulated and signed by the ADMIN.
 */
export function NaturalLanguageInput({ gate }: { gate: AdminGate }) {
  const [text, setText] = useState('');
  const [locale, setLocale] = useState<'vi' | 'en'>('vi');
  const [rows, setRows] = useState<Row[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const write = useRegistryWrite();
  const parse = useMutation({
    mutationFn: async () => (await api.postValidated<typeof ParseObligationsRequestSchema, ParseResponse>('/obligations/parse', ParseObligationsRequestSchema, { text, locale })).data,
    onSuccess: (data) => {
      setRows(data.drafts.map((d) => ({ ...d, amountText: formatUsdcPlain(BigInt(d.amount)), dateText: isoDate(d.firstDueDate), dateEdited: false, state: 'review' })));
      setQuestions(data.needsClarification);
    },
  });

  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.draftId === id ? { ...r, ...patch } : r)));

  async function sign(row: Row) {
    let body;
    try {
      body = CreateObligationRequestSchema.parse(
        draftToCreateRequest({ ...row, amount: parseUsdc(row.amountText).toString(), firstDueDate: draftDueDate(row.firstDueDate, row.dateText, row.dateEdited), recipient: row.recipient?.trim() || null }),
      );
    } catch (e) {
      update(row.draftId, { state: 'error', error: e instanceof Error ? e.message : String(e) });
      return;
    }
    update(row.draftId, { state: 'signing', error: undefined });
    try {
      await write.mutateAsync({
        title: `Create obligation "${body.label}"`,
        kind: 'CREATE_OBLIGATION',
        functionName: 'createObligation',
        prepare: () => api.postValidated<typeof CreateObligationRequestSchema, PrepareTxResponse>('/obligations', CreateObligationRequestSchema, body),
      });
      update(row.draftId, { state: 'done' });
    } catch (e) {
      update(row.draftId, { state: 'error', error: (e as Error).message });
    }
  }

  const input = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm';
  return (
    <section aria-label="Natural language input" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Describe obligations in plain language</h2>
        <div role="group" aria-label="Language" className="flex gap-1">
          {(['vi', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={locale === l} onClick={() => setLocale(l)} className={`rounded-md px-2 py-0.5 text-xs ${locale === l ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <textarea
        aria-label="Obligation description"
        className={`${input} mt-2 h-24`}
        maxLength={2000}
        value={text}
        placeholder={locale === 'vi' ? 'VD: Trả lương tháng 11 20k USDC cho 0x… sau 7 ngày' : 'e.g. Pay November payroll 20k USDC to 0x… in 7 days'}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-2">
        <GatedButton
          gate={gate}
          disabled={!text.trim() || parse.isPending}
          onClick={() => parse.mutate()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {parse.isPending ? 'Reading…' : 'Create drafts'}
        </GatedButton>
        <span className="text-xs text-slate-500">{text.length}/2000 · AI suggests, you review and sign</span>
      </div>
      {parse.error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {(parse.error as Error).message}
        </p>
      ) : null}
      {questions.length ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      ) : null}

      {rows.length ? (
        <ol aria-label="Draft review" className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.draftId} data-state={r.state} className={`rounded-lg border p-3 ${r.state === 'done' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs">
                  Label
                  <input className={input} value={r.label} disabled={r.state !== 'review' && r.state !== 'error'} onChange={(e) => update(r.draftId, { label: e.target.value })} />
                </label>
                <label className="text-xs">
                  Recipient
                  <input className={input} value={r.recipient ?? ''} placeholder="0x…" disabled={r.state !== 'review' && r.state !== 'error'} onChange={(e) => update(r.draftId, { recipient: e.target.value })} />
                </label>
                <label className="text-xs">
                  Amount (USDC)
                  <input className={input} inputMode="decimal" value={r.amountText} disabled={r.state !== 'review' && r.state !== 'error'} onChange={(e) => update(r.draftId, { amountText: e.target.value })} />
                </label>
                <label className="text-xs">
                  First due date (UTC)
                  <input className={input} type="date" value={r.dateText} disabled={r.state !== 'review' && r.state !== 'error'} onChange={(e) => update(r.draftId, { dateText: e.target.value, dateEdited: true })} />
                </label>
              </div>
              {!r.dateEdited && r.firstDueDate % 86_400 !== 0 ? (
                <p className="mt-1 text-xs text-slate-600">Exact due time kept: {new Date(r.firstDueDate * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-600">
                {r.category.replace('_', ' ')} · {intervalLabel(r.interval)}
                {r.interval ? ` · ${r.maxOccurrences === 0 ? 'unlimited' : `${r.maxOccurrences} times`}` : ''} · from “{r.sourceSpan}”
              </p>
              {r.warnings.length ? (
                <ul className="mt-1 text-xs text-amber-800">
                  {r.warnings.map((w) => (
                    <li key={w}>▲ {WARNING_TEXT[w] ?? w}</li>
                  ))}
                </ul>
              ) : null}
              {r.error ? (
                <p role="alert" className="mt-1 text-xs text-red-800">
                  {r.error}
                </p>
              ) : null}
              <div className="mt-2">
                <GatedButton
                  gate={gate}
                  disabled={write.isPending || r.state === 'done' || r.state === 'signing'}
                  onClick={() => void sign(r)}
                  className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                >
                  {r.state === 'done' ? 'Created ✓' : r.state === 'signing' ? 'Signing…' : 'Confirm & sign'}
                </GatedButton>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
