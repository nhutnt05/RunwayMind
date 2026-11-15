'use client';

import { useOverview } from '@/hooks/useApiQueries';
import { useTreasuryReads } from '@/hooks/useTreasuryReads';
import { dayIndex } from '@/lib/dashboard';

/** Demo state from live chain reads, falling back to the backend overview when the RPC is unavailable. */
function useDemoDay(): { demoMode: boolean; day: number | null } {
  const { data } = useTreasuryReads();
  const overview = useOverview();
  const o = overview.data?.data;
  const demoMode = data?.demoMode ?? o?.demoMode ?? false;
  const chainTime = data ? Number(data.currentTime) : o?.chainTime;
  const day = demoMode && chainTime !== undefined ? dayIndex(chainTime, o?.demoStartTime) : null;
  return { demoMode, day };
}

/**
 * Presentational "DEMO MODE · Day N" pill (docs/08 §1). Black on amber-400 (≈ 10:1 contrast) and large, bold type
 * so it stays legible in a screen recording.
 */
export function DemoModeIndicator({ day }: { day: number | null }) {
  return (
    <span
      data-testid="demo-mode-badge"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-400 px-2 py-1 text-sm font-extrabold uppercase tracking-wide text-slate-950 shadow-sm ring-2 ring-amber-600 sm:gap-2 sm:px-3"
      title="Demo mode: time controls are enabled"
    >
      <span aria-hidden>⏱</span>
      {/* Phones: compact "⏱ Day N" pill (text kept for screen readers) so the top bar fits 375 px. */}
      <span className="sr-only sm:not-sr-only">DEMO MODE</span>
      {day !== null ? (
        <span className="rounded-full bg-slate-950 px-2 py-0.5 text-xs font-bold normal-case tracking-normal text-amber-300">
          Day {day}
        </span>
      ) : null}
    </span>
  );
}

/** TopBar badge, shown at every width (the full-width demo strip was removed on 2026-11-14 at the team's request). */
export function DemoModeBadge() {
  const { demoMode, day } = useDemoDay();
  if (!demoMode) return null;
  return (
    <span className="inline-flex">
      <DemoModeIndicator day={day} />
    </span>
  );
}
