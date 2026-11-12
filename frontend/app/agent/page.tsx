'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ActivityTimeline, KeeperStatusCard, ModeSwitch } from '@/components/agent/AgentPanels';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useAgentActivity, useAgentSettings, useKeeperStatus } from '@/hooks/useApiQueries';
import { api } from '@/lib/api';

export default function AgentPage() {
  const gate = useAdminGate();
  const activity = useAgentActivity(50);
  const settings = useAgentSettings();
  const keeper = useKeeperStatus();
  const qc = useQueryClient();
  const evaluate = useMutation({
    mutationFn: () => api.post('/agent/evaluate'),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['agent'] }), qc.invalidateQueries({ queryKey: ['recommendations'] })]),
  });

  return (
    <>
      <PageHeader title="AI Agent Activity" description="Agent decisions, executed actions and keeper runs. Policy-blocked actions are shown in red." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-4">
          <ModeSwitch settings={settings.data?.data} gate={gate} />
          <KeeperStatusCard status={keeper.data?.data} gate={gate} />
          <section aria-label="Evaluate" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              disabled={!gate.enabled || evaluate.isPending}
              title={gate.reason ?? undefined}
              onClick={() => evaluate.mutate()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {evaluate.isPending ? 'Evaluating…' : 'Evaluate now'}
            </button>
            {evaluate.error ? (
              <p role="alert" className="mt-2 text-xs text-red-800">
                {(evaluate.error as Error).message}
              </p>
            ) : null}
          </section>
        </div>
        <div className="lg:col-span-8">
          {activity.isError && !activity.data ? (
            <ErrorState title="Could not load activity" message={(activity.error as Error).message} onRetry={() => void activity.refetch()} />
          ) : !activity.data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ActivityTimeline items={activity.data.data} />
          )}
        </div>
      </div>
    </>
  );
}
