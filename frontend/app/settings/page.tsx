'use client';

import { AgentSettingsForm, DemoControls } from '@/components/settings/AgentAndDemo';
import { AdapterWhitelistTable, PolicyForm, RolesPanel } from '@/components/settings/PolicySettings';
import { AdminGateNotice, ErrorState, PageHeader, SkeletonCard, SkeletonGrid } from '@/components/ui';
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
      <AdminGateNotice gate={gate} context="Settings are read-only." />
      {overview.isError && !o ? (
        <ErrorState title="Could not load settings" message={(overview.error as Error).message} onRetry={() => void overview.refetch()} />
      ) : !o ? (
        <SkeletonGrid label="settings" count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PolicyForm overview={o} gate={gate} />
          <AdapterWhitelistTable overview={o} gate={gate} />
          {settings.data ? (
            <AgentSettingsForm key={JSON.stringify(settings.data.data)} settings={settings.data.data} gate={gate} />
          ) : settings.isError ? (
            <ErrorState title="Could not load agent settings" message={(settings.error as Error).message} onRetry={() => void settings.refetch()} />
          ) : (
            <SkeletonCard label="agent settings" lines={4} />
          )}
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
