'use client';

import { ErrorState, RISK_STYLE, RiskBadge, SkeletonCard } from '@/components/ui';
import { useRunway } from '@/hooks/useApiQueries';
import { CLASS_COLOR, runwayFraction, runwayLabel, worstCaseLine } from '@/lib/insights';

/** Radial gauge 0–365+ days, colored by class, worst stress-scenario runway underneath (docs/06 §2.3, docs/08 §2). */
export function RunwayMeter() {
  const q = useRunway();
  const r = q.data?.data;
  if (!r) {
    return q.isError ? (
      <ErrorState title="Could not load runway" message={(q.error as Error).message} onRetry={() => void q.refetch()} />
    ) : (
      <SkeletonCard label="runway" bodyClassName="h-28" className="h-full" />
    );
  }
  const cls = r.baseline.classification;
  const color = CLASS_COLOR[cls];
  const f = runwayFraction(r.baseline.capped ? 365 : r.baseline.runwayDays);
  // Semicircle from (10,60) to (110,60), radius 50; arc length = π·50.
  const arc = Math.PI * 50;
  const worst = worstCaseLine(r.worstCase);
  return (
    <section aria-label="Runway meter" className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-600">Runway</h2>
        {/* Color + icon + text (docs/08 §9) */}
        <RiskBadge level={cls} size="lg" />
      </div>
      <svg viewBox="0 0 120 70" className="mx-auto mt-1 h-24 w-full max-w-[220px]" role="img" aria-label={`Runway ${runwayLabel(r.baseline)}, ${cls}`}>
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${arc * f} ${arc}`} />
        <text x="60" y="55" textAnchor="middle" fontSize="14" fontWeight="600" fill="#0f172a">
          {runwayLabel(r.baseline)}
        </text>
      </svg>
      <p className={`text-center text-xs font-semibold ${RISK_STYLE[cls].text}`}>{RISK_STYLE[cls].description} runway</p>
      <p className="mt-1 text-center text-xs text-slate-600">{worst ?? 'Run a stress test to see the worst case'}</p>
    </section>
  );
}
