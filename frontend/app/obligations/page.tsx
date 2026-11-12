'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CreateObligationForm } from '@/components/obligations/CreateObligationForm';
import { NaturalLanguageInput } from '@/components/obligations/NaturalLanguageInput';
import { ObligationTable } from '@/components/obligations/ObligationTable';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';
import { api, type ObligationItem } from '@/lib/api';

const STATUS_FILTERS = ['ACTIVE', 'COMPLETED', 'CANCELLED', 'ALL'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function ObligationsPage() {
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const obligations = useQuery({
    queryKey: ['obligations', status],
    queryFn: () => api.get<ObligationItem[]>(`/obligations?status=${status}`),
    refetchInterval: 10_000, // docs/08 §5: 10 s on non-dashboard pages
  });
  const overview = useOverview();
  const chain = useTreasuryReads();
  const gate = useAdminGate();

  const o = overview.data?.data;
  const chainTime = chain.data ? Number(chain.data.currentTime) : (o?.chainTime ?? null);
  const demoStartTime = o?.demoStartTime ?? null;

  return (
    <>
      <PageHeader title="Obligation Management" description="Register, edit and cancel payroll, grants and invoices." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="ob-status" className="text-sm font-medium text-slate-700">
              Show
            </label>
            <select
              id="ob-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          {obligations.data ? (
            <ObligationTable
              obligations={obligations.data.data}
              chainTime={chainTime ?? 0}
              demoStartTime={demoStartTime}
              gate={gate}
            />
          ) : obligations.isError ? (
            <ErrorState
              title="Could not load obligations"
              message={(obligations.error as Error).message}
              onRetry={() => void obligations.refetch()}
            />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
        <div className="space-y-6 xl:col-span-4">
          <NaturalLanguageInput gate={gate} />
          <CreateObligationForm chainTime={chainTime} gate={gate} />
        </div>
      </div>
    </>
  );
}
