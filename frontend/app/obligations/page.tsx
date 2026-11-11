import { EmptyState, PageHeader } from '@/components/ui';

export default function ObligationsPage() {
  return (
    <>
      <PageHeader title="Obligation Management" description="Register, edit and cancel payroll, grants and invoices." />
      <EmptyState title="No obligations yet" description="No obligations yet — add payroll to start the Cash Ladder." />
    </>
  );
}
