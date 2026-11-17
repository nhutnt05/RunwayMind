import type { ReactNode } from 'react';

const ACCENT = {
  slate: 'bg-slate-100 text-slate-700',
  sky: 'bg-sky-50 text-sky-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-700',
} as const;

/** Headline number card. `icon` + `accent` give each metric a recognisable chip; `tone="danger"` flags a problem. */
export function StatCard({
  title,
  value,
  subLabel,
  tone = 'default',
  icon,
  accent = 'slate',
}: {
  title: string;
  value: ReactNode;
  subLabel?: ReactNode;
  tone?: 'default' | 'danger';
  icon?: ReactNode;
  accent?: keyof typeof ACCENT;
}) {
  return (
    <section
      aria-label={title}
      className={`flex h-full flex-col rounded-xl border bg-white p-4 shadow-sm ${tone === 'danger' ? 'border-red-400 ring-1 ring-red-200' : 'border-slate-200'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-600">{title}</h2>
        {icon ? <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone === 'danger' ? 'bg-red-50 text-red-700' : ACCENT[accent]}`}>{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {subLabel ? <div className="mt-auto pt-2 text-xs text-slate-600">{subLabel}</div> : null}
    </section>
  );
}
