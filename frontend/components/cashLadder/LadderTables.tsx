import { AddressChip, AmountText, EmptyState, StateChip } from '@/components/ui';
import type { CashLadderJson } from '@/lib/api';
import { dayLabel } from '@/lib/dashboard';
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
      <h3 className="px-4 pt-4 text-sm font-semibold text-slate-900">Withdrawal schedule</h3>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="px-4 py-2">Deadline</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2">Covers</th>
            <th className="px-4 py-2">Sources</th>
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
              <td className="px-4 py-2 text-xs">
                {it.covers.map((c) => `#${c.obligationId} (occ. ${c.occurrenceIndex}, ${dayLabel(c.dueDate, demoStartTime)})`).join(', ')}
              </td>
              <td className="px-4 py-2 text-xs">
                {it.suggestedSources.map((s) => (
                  <span key={s.adapter} className="mr-2 inline-flex items-center gap-1">
                    <AddressChip address={s.adapter} /> <AmountText value={s.amount} symbol={null} />
                  </span>
                ))}
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

export function OccurrencesTable({ items, demoStartTime }: { items: CashLadderJson['occurrences']; demoStartTime: number | null }) {
  if (!items.length) return <EmptyState title="No upcoming occurrences" description="Create an obligation to see its projected payments." action={{ label: 'Obligations', href: '/obligations' }} />;
  return (
    <section aria-label="Projected occurrences" className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="px-4 pt-4 text-sm font-semibold text-slate-900">Projected occurrences</h3>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="px-4 py-2">Obligation</th>
            <th className="px-4 py-2">Due</th>
            <th className="px-4 py-2">Withdrawal deadline</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2">Category</th>
            <th className="px-4 py-2">State</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={`${o.obligationId}-${o.occurrenceIndex}`} className="border-t border-slate-100">
              <td className="px-4 py-2">
                #{o.obligationId} · occ. {o.occurrenceIndex}
              </td>
              <td className="px-4 py-2">{dayLabel(o.dueDate, demoStartTime)}</td>
              <td className="px-4 py-2">{dayLabel(o.withdrawalDeadline, demoStartTime)}</td>
              <td className="px-4 py-2 text-right">
                <AmountText value={o.amount} />
              </td>
              <td className="px-4 py-2 text-xs">{o.category.replace(/_/g, ' ')}</td>
              <td className="px-4 py-2">
                <StateChip state={o.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
