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
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-amber-400 px-3 py-1 text-sm font-extrabold uppercase tracking-wide text-slate-950 shadow-sm ring-2 ring-amber-600"
      title="Demo mode: time controls are enabled"
    >
      <span aria-hidden>⏱</span>
      DEMO MODE
      {day !== null ? (
        <span className="rounded-full bg-slate-950 px-2 py-0.5 text-xs font-bold normal-case tracking-normal text-amber-300">
          Day {day}
        </span>
      ) : null}
    </span>
  );
}

/** Full-width strip under the top bar (inside the sticky header, so it stays visible while scrolling). */
export function DemoModeBannerView({ day }: { day: number | null }) {
  return (
    <div
      role="status"
      aria-label={`Demo mode${day !== null ? `, day ${day}` : ''}`}
      data-testid="demo-mode-banner"
      className="border-b-2 border-amber-600 bg-amber-300 text-slate-950"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm md:px-6">
        <span className="font-extrabold uppercase tracking-wide">
          <span aria-hidden>⏱ </span>Demo mode
        </span>
        {day !== null ? <span className="rounded bg-slate-950 px-2 py-0.5 font-bold text-amber-300">Day {day}</span> : null}
        <span className="font-medium">Chain time is simulated — not available in production.</span>
      </div>
    </div>
  );
}

/** TopBar badge: hidden on narrow screens, where the banner below carries the same information. */
export function DemoModeBadge() {
  const { demoMode, day } = useDemoDay();
  if (!demoMode) return null;
  return (
    <span className="hidden sm:inline-flex">
      <DemoModeIndicator day={day} />
    </span>
  );
}

export function DemoModeBanner() {
  const { demoMode, day } = useDemoDay();
  if (!demoMode) return null;
  return <DemoModeBannerView day={day} />;
}
