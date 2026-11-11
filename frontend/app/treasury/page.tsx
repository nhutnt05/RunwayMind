import { EmptyState, PageHeader } from '@/components/ui';

export default function TreasuryPage() {
  return (
    <>
      <PageHeader title="Treasury Overview" description="Asset and contract addresses, idle vs vault allocation, policy parameters and circuit breaker." />
      <EmptyState title="Treasury data not loaded yet" description="Connect the backend and deployment to see balances and contract addresses." />
    </>
  );
}
