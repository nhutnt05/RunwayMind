import { EmptyState, PageHeader } from '@/components/ui';

export default function CashLadderPage() {
  return (
    <>
      <PageHeader title="Cash Ladder" description="Required reserve, investable capital, withdrawal schedule and daily liquidity projection." />
      <EmptyState title="No Cash Ladder yet" description="The Cash Ladder appears once obligations are registered." />
    </>
  );
}
