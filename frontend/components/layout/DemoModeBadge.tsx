'use client';

import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';
import { dayIndex } from '@/lib/dashboard';

/** "DEMO MODE · Day N" (docs/08 §1); N from chain time and demoStartTime (docs/04 §4.1). */
export function DemoModeBadge() {
  const { data } = useTreasuryReads();
  const overview = useOverview();
  if (!data?.demoMode) return null;
  const day = dayIndex(Number(data.currentTime), overview.data?.data.demoStartTime);
  return (
    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800" title="Time controls are enabled">
      DEMO MODE{day !== null ? ` · Day ${day}` : ''}
    </span>
  );
}
