'use client';

import { AgentSettingsForm, DemoControls } from '@/components/settings/AgentAndDemo';
import { AdapterWhitelistTable, PolicyForm, RolesPanel } from '@/components/settings/PolicySettings';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useAgentSettings, useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';

export default function SettingsPage() {
  const gate = useAdminGate();
  const overview = useOverview();
  const settings = useAgentSettings();
  const chain = useTreasuryReads();
  const o = overview.data?.data;
  const demoMode = chain.data?.demoMode ?? o?.demoMode ?? false;

  return (
    <>
      <PageHeader title="Settings & Policy Configuration" description="On-chain policy (ADMIN), agent settings, roles and demo controls." />
      {!gate.enabled ? <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{gate.reason} — settings are read-only.</p> : null}
      {overview.isError && !o ? (
        <ErrorState title="Could not load settings" message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
      ) : !o ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PolicyForm overview={o} gate={gate} />
          <AdapterWhitelistTable overview={o} gate={gate} />
          {settings.data ? <AgentSettingsForm key={JSON.stringify(settings.data.data)} settings={settings.data.data} gate={gate} /> : <Skeleton className="h-48 w-full" />}
          <RolesPanel />
          {demoMode ? (
            <div className="lg:col-span-2">
              <DemoControls gate={gate} />
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
