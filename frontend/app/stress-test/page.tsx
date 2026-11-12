'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CreateInflowRequestSchema, parseUsdc, toUtcMidnight } from '@runwaymind/shared';
import { AdminGateNotice, AmountText, EmptyState, ErrorState, GatedButton, PageHeader, RISK_STYLE, RiskBadge, Skeleton, SkeletonGrid, StateChip } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useInflows, useLatestStressTest, useOverview, type StressTestJson } from '@/hooks/useApiQueries';
import { useSiweSession } from '@/hooks/useSiweSession';
import { api } from '@/lib/api';
import { dayLabel } from '@/lib/dashboard';
import { SCENARIO_LABEL, runwayLabel, scenarioKeyNumber, type ScenarioJson } from '@/lib/insights';

function ScenarioCard({ s, worst }: { s: ScenarioJson; worst: boolean }) {
  const a = s.recommendedAction;
  return (
    <article
      aria-label={SCENARIO_LABEL[s.id] ?? s.label}
      data-worst={worst || undefined}
      className={`rounded-xl border p-4 shadow-sm ${worst ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{SCENARIO_LABEL[s.id] ?? s.label}</h2>
        <StateChip state={s.runway.classification} />
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${RISK_STYLE[s.runway.classification].text}`}>{runwayLabel(s.runway)}</p>
      {s.id !== 'BASELINE' ? (
        <p className="text-xs text-slate-600">{s.deltaRunwayDays === 0 ? 'Same as baseline' : `${s.deltaRunwayDays > 0 ? '+' : ''}${s.deltaRunwayDays} days vs baseline`}</p>
      ) : null}
      <p className="mt-2 text-sm text-slate-800">{scenarioKeyNumber(s)}</p>
      <p className="mt-2 text-xs text-slate-700">
        <span className="font-semibold">Recommended: </span>
        {a.action === 'NONE' ? 'no action' : a.action.replace('_', ' ').toLowerCase()}
        {a.amount ? (
          <>
            {' '}
            <AmountText value={a.amount} />
          </>
        ) : null}
        {a.note ? <span className="block text-slate-600">{a.note}</span> : null}
      </p>
    </article>
  );
}

function WorstCaseBanner({ result }: { result: StressTestJson }) {
  const w = [result.baseline, ...result.scenarios].find((x) => x.id === result.worstCase);
  if (!w) return null;
  return (
    <div role="status" className={`mb-4 flex flex-wrap items-center gap-2 rounded-xl border-2 px-4 py-3 text-sm ${RISK_STYLE[result.overallClassification].panel}`}>
      <RiskBadge level={result.overallClassification} size="lg" />
      <span>
        <span className="font-semibold">Worst case: {SCENARIO_LABEL[w.id] ?? w.label}</span> — runway {runwayLabel(w.runway)} · overall{' '}
        {result.overallClassification}
      </span>
    </div>
  );
}

function InflowManager({ demoStartTime }: { demoStartTime: number | null }) {
  const gate = useAdminGate();
  const inflows = useInflows();
  const qc = useQueryClient();
  const [form, setForm] = useState({ label: '', amount: '', date: '' });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['inflows'] }), qc.invalidateQueries({ queryKey: ['runway'] })]);
  const add = useMutation({
    mutationFn: () =>
      api.postValidated('/inflows', CreateInflowRequestSchema, {
        label: form.label.trim(),
        amount: parseUsdc(form.amount).toString(),
        expectedDate: toUtcMidnight(form.date),
      }),
    onSuccess: async () => {
      setForm({ label: '', amount: '', date: '' });
      await invalidate();
    },
    onError: (e) => setError((e as Error).message),
  });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/inflows/${id}`), onSuccess: invalidate });
  const items = inflows.data?.data ?? [];
  return (
    <section aria-label="Expected inflows" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Expected inflows (used by scenario 3)</h2>
      <AdminGateNotice gate={gate} context="Inflows are read-only." />
      {inflows.isError && !inflows.data ? (
        <div className="mt-2">
          <ErrorState title="Could not load inflows" message={(inflows.error as Error).message} onRetry={() => void inflows.refetch()} />
        </div>
      ) : !inflows.data ? (
        <Skeleton className="mt-2 h-10 w-full" />
      ) : items.length ? (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                {i.label} · {dayLabel(i.expectedDate, demoStartTime)}
              </span>
              <span className="flex items-center gap-2">
                <AmountText value={i.amount} />
                <GatedButton
                  gate={gate}
                  className="rounded text-xs font-medium text-red-800 underline"
                  disabled={del.isPending}
                  aria-label={`Remove inflow ${i.label}`}
                  onClick={() => del.mutate(i.id)}
                >
                  Remove
                </GatedButton>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-600">No expected inflows registered — add one below to model scenario 3.</p>
      )}
      <form
        className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          add.mutate();
        }}
      >
        <input aria-label="Inflow label" placeholder="Label" className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input aria-label="Inflow amount" placeholder="Amount (USDC)" inputMode="decimal" className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input aria-label="Expected date" type="date" className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <GatedButton type="submit" gate={gate} disabled={add.isPending} className="w-full rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white">
          Add inflow
        </GatedButton>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function StressTestPage() {
  const latest = useLatestStressTest();
  const overview = useOverview();
  const { isSignedIn } = useSiweSession();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post<StressTestJson>('/stress-tests', {}),
    onSuccess: async (res) => {
      qc.setQueryData(['stress-tests', 'latest'], res.data);
      await qc.invalidateQueries({ queryKey: ['runway'] });
    },
  });
  const result = latest.data;

  return (
    <>
      <PageHeader title="Stress Test" description="Runway under four scenarios: APY −50%, 14-day pool lock, 30-day inflow delay, expenses +20%." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GatedButton
          gate={{ enabled: isSignedIn, reason: isSignedIn ? null : 'Sign in (SIWE) to run a stress test' }}
          disabled={run.isPending}
          onClick={() => run.mutate()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          {run.isPending ? 'Running…' : 'Run stress test'}
        </GatedButton>
        {result ? <span className="text-xs text-slate-600">Last run at chain time {dayLabel(result.ranAt, overview.data?.data.demoStartTime ?? null)}</span> : null}
        {run.error ? (
          <span role="alert" className="text-xs text-red-800">
            {(run.error as Error).message}
          </span>
        ) : null}
      </div>

      {latest.isError ? (
        <ErrorState title="Could not load stress tests" message={(latest.error as Error).message} onRetry={() => void latest.refetch()} />
      ) : latest.isLoading ? (
        <SkeletonGrid label="stress test results" count={5} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5" />
      ) : !result ? (
        <EmptyState title="No stress test runs yet" description="Run a stress test to see runway per scenario." />
      ) : (
        <>
          <WorstCaseBanner result={result} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[result.baseline, ...result.scenarios].map((s) => (
              <ScenarioCard key={s.id} s={s} worst={s.id === result.worstCase} />
            ))}
          </div>
        </>
      )}
      <div className="mt-6">
        <InflowManager demoStartTime={overview.data?.data.demoStartTime ?? null} />
      </div>
    </>
  );
}
