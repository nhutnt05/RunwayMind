import { EmptyState, PageHeader } from '@/components/ui';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings & Policy Configuration" description="On-chain policy (ADMIN), agent settings, roles and demo controls." />
      <EmptyState title="Settings not loaded yet" description="Connect an ADMIN wallet to edit policy and agent settings." />
    </>
  );
}
