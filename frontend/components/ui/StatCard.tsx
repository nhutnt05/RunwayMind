import type { ReactNode } from 'react';

export function StatCard({
  title,
  value,
  subLabel,
  tone = 'default',
}: {
  title: string;
  value: ReactNode;
  subLabel?: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-xl border bg-white p-4 shadow-sm ${tone === 'danger' ? 'border-red-400' : 'border-slate-200'}`}
    >
      <h2 className="text-sm font-medium text-slate-600">{title}</h2>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {subLabel ? <p className="mt-1 text-xs text-slate-600">{subLabel}</p> : null}
    </section>
  );
}
