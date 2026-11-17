import { AmountText, EmptyState, StateChip } from '@/components/ui';
import type { CashLadderJson } from '@/lib/api';
import type { Category } from '@runwaymind/shared';
import { countdown, dayLabel } from '@/lib/dashboard';
import { categoryLabel } from '@/lib/obligationFilters';
import { bpsToPercentText } from '@/lib/views';

export function LadderSummary({ ladder, safetyHorizonSec, emergencyBuffer }: { ladder: CashLadderJson; safetyHorizonSec: number; emergencyBuffer: string }) {
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
  return (
    <section aria-label="Ladder summary" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {item('Required reserve', <AmountText value={ladder.requiredReserve} />)}
        {item('Investable capital', <AmountText value={ladder.investableCapital} />)}
        {item('Efficiency (actual / plan)', `${bpsToPercentText(ladder.actualEfficiencyBps)}% / ${bpsToPercentText(ladder.capitalEfficiencyBps)}%`)}
        {item('Safety horizon (H)', `${Math.floor(safetyHorizonSec / 86_400)} days`)}
        {item('Emergency buffer', <AmountText value={emergencyBuffer} />)}
      </dl>
      {ladder.warnings.length ? (
        <ul className="mt-3 space-y-1">
          {ladder.warnings.map((w) => (
            <li key={`${w.code}-${w.at ?? ''}`} role="alert" className="text-xs font-medium text-red-800">
              ▲ {w.code.replace(/_/g, ' ')}: {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function WithdrawalScheduleTable({ items, demoStartTime }: { items: CashLadderJson['withdrawalSchedule']; demoStartTime: number | null }) {
  if (!items.length) return <EmptyState title="No withdrawals needed" description="Idle balance already covers every obligation in the horizon." />;
  return (
    <section aria-label="Withdrawal schedule" className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="px-4 pt-4 text-sm font-semibold text-slate-900">Withdrawal schedule</h2>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="px-4 py-2">Deadline</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={`${it.deadline}-${it.amount}`} className="border-t border-slate-100">
              <td className="px-4 py-2">{dayLabel(it.deadline, demoStartTime)}</td>
              <td className="px-4 py-2 text-right">
                <AmountText value={it.amount} />
              </td>
              <td className="px-4 py-2">
                <StateChip state={it.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Upcoming payments in the projection window, numbered in date order. Obligations are shown by name (`labels`:
 * obligationId → label); repeat payments of a recurring obligation say which payment they are.
 */
export function OccurrencesTable({
  items,
  chainTime,
  labels = new Map(),
}: {
  items: CashLadderJson['occurrences'];
  chainTime: number;
  labels?: ReadonlyMap<string, string>;
  demoStartTime?: number | null;
}) {
  if (!items.length) return <EmptyState title="No upcoming occurrences" description="Create an obligation to see its projected payments." action={{ label: 'Obligations', href: '/obligations' }} />;
  return (
    <section aria-labelledby="occurrences-title" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 pt-4">
        <h2 id="occurrences-title" className="text-sm font-semibold text-slate-900">
          Projected occurrences
        </h2>
        <p className="mt-0.5 text-xs text-slate-600">Every payment due in the projection window, earliest first.</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="w-14 px-4 py-2 text-center">No.</th>
              <th scope="col" className="px-4 py-2">Obligation</th>
              <th scope="col" className="px-4 py-2">Due</th>
              <th scope="col" className="px-4 py-2">Withdrawal deadline</th>
              <th scope="col" className="px-4 py-2">Amount</th>
              <th scope="col" className="px-4 py-2">Category</th>
              <th scope="col" className="px-4 py-2">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((o, i) => (
              <tr key={`${o.obligationId}-${o.occurrenceIndex}`} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 text-center">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold tabular-nums text-slate-900 ring-1 ring-slate-200">
                    {i + 1}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-slate-900">{labels.get(String(o.obligationId)) ?? 'Untitled obligation'}</span>
                  {o.occurrenceIndex > 1 ? <span className="block text-xs text-slate-500">Payment {o.occurrenceIndex}</span> : null}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  <span className="font-medium text-slate-900">{dayLabel(o.dueDate)}</span>
                  <span className="block text-slate-500">{countdown(o.dueDate, chainTime)}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-700">{dayLabel(o.withdrawalDeadline)}</td>
                <td className="px-4 py-2.5">
                  <AmountText value={o.amount} />
                </td>
                <td className="px-4 py-2.5">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{categoryLabel(o.category as Category)}</span>
                </td>
                <td className="px-4 py-2.5">
                  <StateChip state={o.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
