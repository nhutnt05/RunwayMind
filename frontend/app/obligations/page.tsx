'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CategorySchema } from '@runwaymind/shared';
import { ObligationTable } from '@/components/obligations/ObligationTable';
import { AdminGateNotice, ErrorState, PageHeader, SkeletonCard } from '@/components/ui';
import { SearchIcon } from '@/components/ui/icons';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';
import {
  NO_FILTERS,
  categoryLabel,
  filterObligations,
  hasActiveFilters,
  type CategoryFilter,
  type ObligationFilters,
} from '@/lib/obligationFilters';
import { obligationsQuery } from '@/lib/queries';

const STATUS_FILTERS = ['ACTIVE', 'COMPLETED', 'CANCELLED', 'ALL'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function ObligationsPage() {
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const obligations = useQuery({
    ...obligationsQuery(status),
    refetchInterval: 10_000, // docs/08 §5: 10 s on non-dashboard pages
  });
  const overview = useOverview();
  const chain = useTreasuryReads();
  const gate = useAdminGate();
  const [filters, setFilters] = useState<ObligationFilters>(NO_FILTERS);
  const all = obligations.data?.data;
  const visible = useMemo(() => (all ? filterObligations(all, filters) : null), [all, filters]);
  const filtering = hasActiveFilters(filters);
  const clearFilters = () => setFilters(NO_FILTERS);

  const o = overview.data?.data;
  const chainTime = chain.data ? Number(chain.data.currentTime) : (o?.chainTime ?? null);
  const demoStartTime = o?.demoStartTime ?? null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4">
        <PageHeader title="Obligation Management" description="Register, edit and cancel payroll, grants and invoices." />
        {/* Creation lives on its own page (/obligations/new) to keep this list compact. */}
        <Link
          href="/obligations/new"
          className="mb-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        >
          <span aria-hidden className="text-base leading-none">+</span>
          Create obligation
        </Link>
      </div>
      <AdminGateNotice gate={gate} context="Creating, editing and cancelling obligations is disabled." />
      <div>
        <div>
          <div role="search" aria-label="Filter obligations" className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="relative w-full sm:w-72">
              <label htmlFor="ob-search" className="sr-only">
                Search by label
              </label>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="ob-search"
                type="search"
                autoComplete="off"
                placeholder="Search by label…"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm placeholder:text-slate-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="ob-category" className="text-sm font-medium text-slate-700">
                Category
              </label>
              <select
                id="ob-category"
                value={filters.category}
                onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value as CategoryFilter }))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="ALL">All</option>
                {CategorySchema.options.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="ob-status" className="text-sm font-medium text-slate-700">
                Show
              </label>
              <select
                id="ob-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {all && visible && filtering ? (
                <p aria-live="polite" className="text-xs text-slate-500" data-testid="obligation-count">
                  Showing {visible.length} of {all.length}
                </p>
              ) : null} 
              {filtering ? (
                <button type="button" onClick={clearFilters} className="rounded-md px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-50">
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>
          {all && visible && filtering && visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="text-base font-semibold text-slate-900">No obligations match</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-slate-600">
                Nothing in “{status === 'ALL' ? 'all statuses' : status.toLowerCase()}” matches these filters.
              </p>
              <button type="button" onClick={clearFilters} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
                Clear filters
              </button>
            </div>
          ) : visible ? (
            <ObligationTable
              obligations={visible}
              chainTime={chainTime ?? 0}
              demoStartTime={demoStartTime}
              gate={gate}
              asset={overview.data?.data.asset ?? null}
              showActions={status === 'ACTIVE' || status === 'ALL'}
            />
          ) : obligations.isError ? (
            <ErrorState
              title="Could not load obligations"
              message={(obligations.error as Error).message}
              onRetry={() => void obligations.refetch()}
            />
          ) : (
            <SkeletonCard label="obligations" lines={5} />
          )}
        </div>
      </div>
    </>
  );
}
