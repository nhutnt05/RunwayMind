'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ActivityTimeline, KeeperStatusCard, ModeSwitch } from '@/components/agent/AgentPanels';
import { AdminGateNotice, ErrorState, GatedButton, PageHeader, SkeletonCard } from '@/components/ui';
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
      <AdminGateNotice gate={gate} context="Mode switch, keeper run and evaluation are disabled." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-4">
          {settings.isError && !settings.data ? (
            <ErrorState title="Could not load agent settings" message={(settings.error as Error).message} onRetry={() => void settings.refetch()} />
          ) : !settings.data ? (
            <SkeletonCard label="agent mode" />
          ) : (
            <ModeSwitch settings={settings.data.data} gate={gate} />
          )}
          {keeper.isError && !keeper.data ? (
            <ErrorState title="Could not load keeper status" message={(keeper.error as Error).message} onRetry={() => void keeper.refetch()} />
          ) : !keeper.data ? (
            <SkeletonCard label="keeper status" lines={3} />
          ) : (
            <KeeperStatusCard status={keeper.data.data} gate={gate} />
          )}
          <section aria-label="Evaluate" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Run the agent</h2>
            <GatedButton
              gate={gate}
              disabled={evaluate.isPending}
              onClick={() => evaluate.mutate()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              {evaluate.isPending ? 'Evaluating…' : 'Evaluate now'}
            </GatedButton>
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
            <SkeletonCard label="agent activity" lines={6} />
          ) : (
            <ActivityTimeline items={activity.data.data} />
          )}
        </div>
      </div>
    </>
  );
}
