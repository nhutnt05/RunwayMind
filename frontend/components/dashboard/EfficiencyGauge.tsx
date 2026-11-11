import { efficiencyLabel } from '@/lib/dashboard';

/** docs/08 §2: "70% invested (target 70%)". Both values come from the engine (bps). */
export function EfficiencyGauge({ actualBps, targetBps }: { actualBps: number; targetBps: number }) {
  const width = Math.min(100, actualBps / 100);
  const target = Math.min(100, targetBps / 100);
  return (
    <section aria-label="Capital efficiency" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-medium text-slate-600">Capital efficiency</h3>
      <p className="mt-1 text-lg font-semibold text-slate-900">{efficiencyLabel(actualBps, targetBps)}</p>
      <div
        className="relative mt-3 h-3 rounded-full bg-slate-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label="Share of total assets invested"
      >
        <div className="h-3 rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
        <div
          aria-hidden
          title={`Target ${target}%`}
          className="absolute -top-1 h-5 w-0.5 bg-slate-900"
          style={{ left: `${target}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-600">
        Bar = invested now · marker = planned target (investable capital ÷ total assets)
      </p>
    </section>
  );
}
