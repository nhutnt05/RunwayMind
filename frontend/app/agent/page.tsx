import { EmptyState, PageHeader } from '@/components/ui';

export default function AgentPage() {
  return (
    <>
      <PageHeader title="AI Agent Activity" description="Agent decisions, executed actions and keeper runs." />
      <EmptyState title="No agent activity yet" description="Decisions appear here after the first agent tick." />
    </>
  );
}
