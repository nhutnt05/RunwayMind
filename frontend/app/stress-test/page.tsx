import { EmptyState, PageHeader } from '@/components/ui';

export default function StressTestPage() {
  return (
    <>
      <PageHeader title="Stress Test" description="Runway under four scenarios: APY −50%, 14-day pool lock, 30-day inflow delay, expenses +20%." />
      <EmptyState title="No stress test runs yet" description="Run a stress test to see runway per scenario." />
    </>
  );
}
