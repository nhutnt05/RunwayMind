import { EmptyState, PageHeader } from '@/components/ui';

export default function PoolsPage() {
  return (
    <>
      <PageHeader title="Pool Risk Dashboard" description="Pool Risk Score (100 = safest) from utilization, APY volatility, TVL and pause status." />
      <EmptyState title="No pool risk data yet" description="Risk scores appear after the agent samples pool metrics." />
    </>
  );
}
