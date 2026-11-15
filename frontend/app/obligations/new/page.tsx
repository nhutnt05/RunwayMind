'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CreateObligationForm } from '@/components/obligations/CreateObligationForm';
import { NaturalLanguageInput } from '@/components/obligations/NaturalLanguageInput';
import { AdminGateNotice, PageHeader } from '@/components/ui';
import { CheckCircleIcon } from '@/components/ui/icons';
import { useAdminGate } from '@/hooks/useAdminGate';
import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';

/**
 * Create obligations (moved off the list page to keep /obligations compact): plain-language drafts or the form.
 * Stays on this page after a creation so several obligations can be added in a row; confirmed ones are listed with a
 * link back to the list.
 */
export default function NewObligationPage() {
  const gate = useAdminGate();
  const overview = useOverview();
  const chain = useTreasuryReads();
  const chainTime = chain.data ? Number(chain.data.currentTime) : (overview.data?.data.chainTime ?? null);
  const [created, setCreated] = useState<string[]>([]);
  const onCreated = (label: string) => setCreated((c) => [...c, label]);

  return (
    <>
      <Link
        href="/obligations"
        className="mb-3 inline-flex items-center gap-1 rounded-md text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <span aria-hidden>←</span> Back to obligations
      </Link>
      <PageHeader
        title="Create Obligation"
        description="Describe obligations in plain language and review the drafts, or fill in the form. Each obligation is registered on-chain with your wallet."
      />
      <AdminGateNotice gate={gate} context="Creating obligations is disabled." />

      {created.length > 0 ? (
        <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950">
          <div className="flex items-start gap-2">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <p className="font-medium">
                {created.length === 1 ? '1 obligation created on-chain' : `${created.length} obligations created on-chain`}
              </p>
              <p className="text-emerald-900">{created.join(' · ')}</p>
            </div>
          </div>
          <Link href="/obligations" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">
            View obligations
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NaturalLanguageInput gate={gate} onCreated={onCreated} />
        <CreateObligationForm chainTime={chainTime} gate={gate} onCreated={onCreated} />
      </div>
    </>
  );
}
