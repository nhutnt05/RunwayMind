import { EmptyState, PageHeader } from '@/components/ui';

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transaction History" description="Every transaction initiated by the agent, keeper or this dashboard." />
      <EmptyState title="No transactions yet" description="Tracked transactions will be listed with Snowtrace links." />
    </>
  );
}
