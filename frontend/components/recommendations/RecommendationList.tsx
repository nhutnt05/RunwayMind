'use client';

import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useDecideRecommendation, usePendingRecommendations, useRecommendation } from '@/hooks/useRecommendations';
import type { AgentDecisionJson } from '@/lib/api';
import { formatDecodedError } from '@/lib/preparedTx';
import { decisionHeadline, decisionTxStatus, latestAction, type AdminGate } from '@/lib/recommendations';
import { txTracker } from '@/lib/txTracker';
import { RecommendationCard } from './RecommendationCard';

type Busy = { id: string; kind: 'approve' | 'reject' } | null;

/** Dashboard list of agent recommendations (docs/08 §2) — `/recommendations?status=PENDING_APPROVAL`. */
/**
 * Wall-clock seconds, ticking every second (approval TTLs are wall-clock, see RecommendationCard). The tick only runs
 * while a card is on screen: with an empty list it would re-render the whole list every second for nothing.
 */
function useWallClockSec(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function RecommendationList() {
  const pending = usePendingRecommendations();
  const { approve, reject } = useDecideRecommendation();
  const gate = useAdminGate();

  // Decisions this user approved/rejected: they leave the PENDING list, so they are polled individually until
  // EXECUTED / BLOCKED_BY_POLICY (docs/07 §7).
  const [tracked, setTracked] = useState<string[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nowSec = useWallClockSec(tracked.length > 0 || (pending.data?.data.length ?? 0) > 0);

  function handle(kind: 'approve' | 'reject', id: string) {
    setBusy({ id, kind });
    setErrors(({ [id]: _drop, ...rest }) => rest);
    const done = {
      onSuccess: () => setTracked((t) => (t.includes(id) ? t : [id, ...t])),
      onError: (e: Error) => setErrors((m) => ({ ...m, [id]: e.message })),
      onSettled: () => setBusy(null),
    };
    if (kind === 'approve') {
      txTracker.upsert({ id: `rec-${id}`, title: 'Approve recommendation', status: 'PENDING', message: 'Submitting approval…' });
      approve.mutate(id, {
        ...done,
        onError: (e: Error) => {
          done.onError(e);
          txTracker.upsert({ id: `rec-${id}`, status: 'FAILED', message: e.message });
        },
      });
    } else {
      reject.mutate({ id }, done);
    }
  }

  const items = pending.data?.data ?? [];
  const untracked = items.filter((d) => !tracked.includes(d.id));

  return (
    <section aria-label="Agent recommendations" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-medium text-slate-600">Agent recommendations</h2>
      <div className="mt-3 space-y-3">
        {tracked.map((id) => (
          <TrackedRecommendation key={id} id={id} nowSec={nowSec} gate={gate} />
        ))}
        {pending.isLoading ? (
          <SkeletonCard label="agent recommendations" lines={3} />
        ) : pending.isError && !pending.data ? (
          <ErrorState
            title="Could not load recommendations"
            message={(pending.error as Error).message}
            onRetry={() => void pending.refetch()}
          />
        ) : untracked.length === 0 && tracked.length === 0 ? (
          <EmptyState title="No pending recommendations" description="The agent will propose actions here when they are needed." />
        ) : (
          untracked.map((d) => (
            <RecommendationCard
              key={d.id}
              decision={d}
              nowSec={nowSec}
              gate={gate}
              busy={busy?.id === d.id ? busy.kind : null}
              error={errors[d.id] ?? null}
              onApprove={(id) => handle('approve', id)}
              onReject={(id) => handle('reject', id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

/** A decision acted on in this session: polls `/recommendations/:id` and mirrors its progress into a TxToast. */
function TrackedRecommendation({ id, nowSec, gate }: { id: string; nowSec: number; gate: AdminGate }) {
  const { data } = useRecommendation(id);
  useDecisionToast(data);
  if (!data) return <Skeleton className="h-28 w-full" />;
  return <RecommendationCard decision={data} nowSec={nowSec} gate={gate} />;
}

function useDecisionToast(decision: AgentDecisionJson | undefined) {
  const status = decision?.status;
  const action = decision ? latestAction(decision) : undefined;
  const hash = action?.txHash ?? undefined;
  useEffect(() => {
    if (!decision || !status || status === 'PENDING_APPROVAL' || status === 'REJECTED') return;
    const message =
      status === 'BLOCKED_BY_POLICY'
        ? `Blocked by policy — ${formatDecodedError(action?.decodedError)}`
        : status === 'EXECUTED'
          ? 'Executed by the agent'
          : status.replace(/_/g, ' ').toLowerCase();
    txTracker.upsert({
      id: `rec-${decision.id}`,
      title: decisionHeadline(decision),
      status: decisionTxStatus(status),
      ...(hash ? { hash } : {}),
      message,
    });
    // Only re-run on progress (status / tx hash), not on every poll.
  }, [status, hash]); // decision/action read at the time of the change
}
