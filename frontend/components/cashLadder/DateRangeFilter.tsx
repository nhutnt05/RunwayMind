'use client';

// Date range control for the Liquidity projection: quick presets plus a two-handle slider over the projected days.
// Native <input type="range"> handles keep keyboard support (←/→ = 1 day, PageUp/PageDown, Home/End) and expose the
// chosen date to screen readers through aria-valuetext. Dates are DD/MM/YY (UTC), like the rest of the UI.
import { dayLabel } from '@/lib/dashboard';

const PRESETS = [7, 14, 30, 90] as const;

export interface DateRangeFilterProps {
  /** Projection day timestamps, oldest → newest (one per day). */
  dates: readonly number[];
  /** Selected indexes into `dates` (inclusive). */
  fromIndex: number;
  toIndex: number;
  onChange: (fromIndex: number, toIndex: number) => void;
}

const THUMB = 18; // px; keep in sync with .rm-range in globals.css

/** Position along the slider track, matching where the browser draws the thumb centre. */
const pos = (i: number, last: number) => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${last === 0 ? 0 : i / last})`;

export function DateRangeFilter({ dates, fromIndex, toIndex, onChange }: DateRangeFilterProps) {
  const last = dates.length - 1;
  if (last < 1) return null;
  const days = toIndex - fromIndex + 1;
  const isAll = fromIndex === 0 && toIndex === last;
  const presets = PRESETS.filter((n) => n < dates.length);
  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div role="group" aria-label="Date range" className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 pb-2 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick range">
          {presets.map((n) => chip(`Next ${n} days`, fromIndex === 0 && toIndex === n - 1, () => onChange(0, n - 1)))}
          {chip('All', isAll, () => onChange(0, last))}
        </div>
        <p className="text-sm tabular-nums text-slate-900" aria-live="polite" data-testid="date-range-summary">
          <span className="font-semibold">{dayLabel(dates[fromIndex]!)}</span>
          <span aria-hidden className="mx-1.5 text-slate-400">
            →
          </span>
          <span className="sr-only"> to </span>
          <span className="font-semibold">{dayLabel(dates[toIndex]!)}</span>
          <span className="ml-2 text-xs text-slate-500">
            {days} {days === 1 ? 'day' : 'days'}
          </span>
        </p>
      </div>

      <div className="relative mt-3 h-6">
        {/* Track and selected segment (decorative; the inputs below carry the semantics). */}
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
        <div
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-900"
          style={{ left: pos(fromIndex, last), width: `calc(${pos(toIndex, last)} - ${pos(fromIndex, last)})` }}
        />
        <input
          type="range"
          className="rm-range"
          min={0}
          max={last}
          step={1}
          value={fromIndex}
          aria-label="Start date"
          aria-valuetext={dayLabel(dates[fromIndex]!)}
          // When both handles meet at the end, the start handle must stay on top so it can still be dragged left.
          style={{ zIndex: fromIndex > last / 2 ? 3 : 2 }}
          onChange={(e) => onChange(Math.min(Number(e.target.value), toIndex), toIndex)}
        />
        <input
          type="range"
          className="rm-range"
          min={0}
          max={last}
          step={1}
          value={toIndex}
          aria-label="End date"
          aria-valuetext={dayLabel(dates[toIndex]!)}
          style={{ zIndex: fromIndex > last / 2 ? 2 : 3 }}
          onChange={(e) => onChange(fromIndex, Math.max(Number(e.target.value), fromIndex))}
        />
      </div>
      <div aria-hidden className="mt-0.5 flex justify-between text-[11px] tabular-nums text-slate-500">
        <span>{dayLabel(dates[0]!)}</span>
        <span>{dayLabel(dates[last]!)}</span>
      </div>
    </div>
  );
}
