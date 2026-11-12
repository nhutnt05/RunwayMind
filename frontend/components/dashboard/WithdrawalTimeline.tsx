import { AmountText, EmptyState, StateChip } from '@/components/ui';
import type { WithdrawalScheduleJson } from '@/lib/api';
import { dayLabel, timelinePosition } from '@/lib/dashboard';

/** Horizontal timeline from now to the last due date: withdrawal deadlines and the due dates they cover (docs/08 §2). */
export function WithdrawalTimeline({
  items,
  chainTime,
  demoStartTime,
}: {
  items: WithdrawalScheduleJson['items'];
  chainTime: number;
  demoStartTime: number | null;
}) {
  if (items.length === 0) {
    return (
      <section aria-label="Withdrawal timeline" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-slate-600">Withdrawal timeline</h2>
        <div className="mt-3">
          <EmptyState title="No upcoming withdrawals" description="Every obligation in the horizon is covered by idle funds." />
        </div>
      </section>
    );
  }
  const end = Math.max(...items.flatMap((i) => [i.deadline, ...i.covers.map((c) => c.dueDate)]));
  return (
    <section aria-label="Withdrawal timeline" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-medium text-slate-600">Withdrawal timeline</h2>
      <div className="relative mx-2 mt-10 hidden h-1 rounded bg-slate-200 md:block" aria-hidden>
        <span className="absolute -top-6 left-0 -translate-x-1/2 text-xs text-slate-600">{dayLabel(chainTime, demoStartTime)}</span>
        {items.map((item) => (
          <span
            key={`d-${item.deadline}`}
            className="absolute -top-1.5 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-amber-500"
            style={{ left: `${timelinePosition(item.deadline, chainTime, end)}%` }}
            title={`Withdraw by ${dayLabel(item.deadline, demoStartTime)}`}
          />
        ))}
        {items.flatMap((item) =>
          item.covers.map((c) => (
            <span
              key={`p-${c.obligationId}-${c.occurrenceIndex}`}
              className="absolute -top-1.5 h-4 w-4 -translate-x-1/2 rotate-45 border-2 border-white bg-sky-600"
              style={{ left: `${timelinePosition(c.dueDate, chainTime, end)}%` }}
              title={`Payment ${dayLabel(c.dueDate, demoStartTime)}`}
            />
          )),
        )}
      </div>
      <p className="mt-4 hidden text-xs text-slate-600 md:block">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden /> withdrawal deadline
        <span className="ml-3 mr-1 inline-block h-2 w-2 rotate-45 bg-sky-600" aria-hidden /> payment due
      </p>
      <ol className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.deadline} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="font-semibold text-slate-900">{dayLabel(item.deadline, demoStartTime)}</span>
            <span className="text-slate-700">
              {BigInt(item.amount) > 0n ? (
                <>
                  withdraw <AmountText value={item.amount} />
                </>
              ) : (
                'covered by idle funds'
              )}
            </span>
            <span className="text-xs text-slate-600">
              for {item.covers.map((c) => `#${c.obligationId} due ${dayLabel(c.dueDate, demoStartTime)}`).join(', ')}
            </span>
            <span className="ml-auto">
              <StateChip state={item.state} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
