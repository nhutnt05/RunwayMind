import { AmountText, EmptyState, StateChip } from '@/components/ui';
import type { ObligationItem } from '@/lib/api';
import { countdown, dayLabel } from '@/lib/dashboard';

/** Next 5 active obligations by due date (docs/08 §2). */
export function UpcomingObligationsList({
  obligations,
  chainTime,
  demoStartTime,
}: {
  obligations: ObligationItem[];
  chainTime: number;
  demoStartTime: number | null;
}) {
  const next = [...obligations].sort((a, b) => a.nextDueDate - b.nextDueDate).slice(0, 5);
  return (
    <section aria-label="Upcoming obligations" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-medium text-slate-600">Upcoming obligations</h2>
      {next.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No obligations yet"
            description="Add payroll to start the Cash Ladder."
            action={{ label: 'Add obligation', href: '/obligations' }}
          />
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {next.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{o.metadata?.label ?? `Obligation #${o.id}`}</p>
                <p className="text-xs text-slate-600">
                  {o.category.replace('_', ' ')} · due {dayLabel(o.nextDueDate, demoStartTime)} ({countdown(o.nextDueDate, chainTime)})
                </p>
              </div>
              <AmountText value={o.amount} className="text-sm font-semibold" />
              <StateChip state={o.derivedState} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
