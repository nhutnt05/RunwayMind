import { AmountText, EmptyState } from '@/components/ui';
import type { WithdrawalScheduleJson } from '@/lib/api';
import { countdown, dayLabel, timelinePosition, timelineTicks } from '@/lib/dashboard';

type Item = WithdrawalScheduleJson['items'][number];

/** Plain-language status per withdrawal state (colour + icon + text, docs/08 §9). */
const STATE: Record<string, { label: string; className: string; icon: string }> = {
  SATISFIED_BY_IDLE: { label: 'No withdrawal needed', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: '✓' },
  UPCOMING: { label: 'Upcoming', className: 'bg-sky-50 text-sky-800 ring-sky-200', icon: '◷' },
  DUE_NOW: { label: 'Withdraw now', className: 'bg-amber-50 text-amber-900 ring-amber-300', icon: '▲' },
};

/** "November payroll" when the obligation is known, otherwise "obligation #9". */
const nameOf = (id: string, labels: ReadonlyMap<string, string>) => labels.get(id) ?? `obligation #${id}`;

/**
 * Withdrawal timeline (docs/08 §2): a small time chart (shared date axis, one lane per withdrawal from its
 * "withdraw by" date to the payment it protects) above one row per withdrawal with the details.
 */
export function WithdrawalTimeline({
  items,
  chainTime,
  labels = new Map(),
}: {
  items: WithdrawalScheduleJson['items'];
  chainTime: number;
  /** obligationId → label, to name payments instead of showing ids. */
  labels?: ReadonlyMap<string, string>;
  demoStartTime?: number | null;
}) {
  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Withdrawal timeline</h2>
        <p className="text-xs text-slate-600">When money has to be back from the vault before each payment.</p>
      </div>
      {items.length ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-700 bg-white" /> withdraw by
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-sky-600" /> payment due
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-4 rounded-full bg-amber-400" /> must withdraw
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1.5 w-4 rounded-full bg-emerald-400" /> covered by idle cash
          </li>
        </ul>
      ) : null}
    </div>
  );

  if (items.length === 0) {
    return (
      <section aria-label="Withdrawal timeline" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {header}
        <div className="mt-3">
          <EmptyState title="No upcoming withdrawals" description="Every obligation in the horizon is covered by idle funds." />
        </div>
      </section>
    );
  }

  const lastDate = Math.max(...items.flatMap((i) => [i.deadline, ...i.covers.map((c) => c.dueDate)]));
  // 4 % breathing room after the last payment so its diamond and label are not cut off.
  const end = lastDate + Math.max(86_400, (lastDate - chainTime) * 0.04);
  return (
    <section aria-label="Withdrawal timeline" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {header}

      <TimelineChart items={items} chainTime={chainTime} end={end} labels={labels} />

      <ol className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
        {items.map((item) => (
          <TimelineRow key={item.deadline} item={item} chainTime={chainTime} labels={labels} />
        ))}
      </ol>
    </section>
  );
}

function TimelineRow({ item, chainTime, labels }: { item: Item; chainTime: number; labels: ReadonlyMap<string, string> }) {
  const state = STATE[item.state] ?? { label: item.state.replace(/_/g, ' '), className: 'bg-slate-100 text-slate-700 ring-slate-200', icon: '•' };
  const withdraw = BigInt(item.amount) > 0n;
  const [day, month] = dayLabel(item.deadline).split('/');
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-3 py-3 sm:flex">
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-100 text-slate-900" aria-hidden>
        <span className="text-base font-bold leading-none tabular-nums">{day}</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase leading-none text-slate-600">/{month}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          <span className="sr-only">{dayLabel(item.deadline)}: </span>
          {withdraw ? (
            <>
              Withdraw <AmountText value={item.amount} /> from the vault
            </>
          ) : (
            'Covered by idle funds'
          )}
          <span className="ml-2 text-xs font-normal text-slate-500">{countdown(item.deadline, chainTime)}</span>
        </p>
        <CoveredPayments covers={item.covers} labels={labels} />
      </div>
      <span className={`col-start-2 inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${state.className}`}>
        <span aria-hidden>{state.icon}</span>
        {state.label}
      </span>
    </li>
  );
}

/**
 * Which payments this withdrawal is for, in the same format for every row: a heading ("Before 4 payments on
 * 01/01/27:") and one tag per payment with its name and amount (and its own date when the dates differ).
 */
function CoveredPayments({ covers, labels }: { covers: Item['covers']; labels: ReadonlyMap<string, string> }) {
  if (covers.length === 0) return null;
  const sameDay = covers.every((c) => dayLabel(c.dueDate) === dayLabel(covers[0]!.dueDate));
  return (
    <div className="mt-1">
      <p className="text-xs text-slate-600">
        Before {covers.length} {covers.length === 1 ? 'payment' : 'payments'}
        {sameDay ? ` on ${dayLabel(covers[0]!.dueDate)}` : ''}:
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {covers.map((c) => (
          <li
            key={`${c.obligationId}-${c.occurrenceIndex}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-900 ring-1 ring-sky-100"
          >
            <span aria-hidden className="inline-block h-1.5 w-1.5 rotate-45 bg-sky-600" />
            <span className="font-medium">{nameOf(c.obligationId, labels)}</span>
            <span className="tabular-nums text-sky-800">
              <AmountText value={c.amount} symbol={null} />
            </span>
            {sameDay ? null : <span className="text-sky-700">· {dayLabel(c.dueDate)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const LANE_PX = 34;

/**
 * Gantt-style chart: date axis with evenly spaced ticks and a "today" line, then one lane per withdrawal. Each lane
 * runs from the withdraw-by date (○) to the payment(s) it protects (◆); amber = money must come back from the vault,
 * green = idle cash already covers it. Decorative: the list below carries the same facts for screen readers/phones.
 */
function TimelineChart({ items, chainTime, end, labels }: { items: readonly Item[]; chainTime: number; end: number; labels: ReadonlyMap<string, string> }) {
  const x = (t: number) => `${timelinePosition(t, chainTime, end)}%`;
  const { ticks } = timelineTicks(chainTime, end, 8);
  const short = (t: number) => dayLabel(t).slice(0, 5); // DD/MM
  return (
    <div className="mt-4 hidden md:block" aria-hidden>
      <div className="relative ml-1 mr-3">
        {/* axis */}
        <div className="relative h-6 border-b border-slate-300">
          {ticks.map((t) => (
            <span key={t} className="absolute bottom-0 -translate-x-1/2 text-center" style={{ left: x(t) }}>
              <span className="block pb-1 text-[11px] tabular-nums text-slate-500">{short(t)}</span>
              <span className="mx-auto block h-1.5 w-px bg-slate-300" />
            </span>
          ))}
        </div>

        {/* lanes */}
        <div className="relative" style={{ height: items.length * LANE_PX + 8 }}>
          {/* vertical grid lines at each tick */}
          {ticks.map((t) => (
            <span key={`g-${t}`} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: x(t) }} />
          ))}
          {/* today */}
          <span className="absolute inset-y-0 left-0 border-l-2 border-dashed border-slate-800" />

          {items.map((item, i) => {
            const pays = item.covers.map((c) => c.dueDate);
            const lastPay = pays.length ? Math.max(...pays) : item.deadline;
            const withdraw = BigInt(item.amount) > 0n;
            const top = 8 + i * LANE_PX;
            const tone = withdraw ? { bar: 'bg-amber-300', ring: 'border-amber-600' } : { bar: 'bg-emerald-300', ring: 'border-emerald-600' };
            return (
              <div key={item.deadline} className="absolute inset-x-0" style={{ top, height: LANE_PX - 8 }}>
                {/* zebra lane */}
                <span className={`absolute inset-0 rounded ${i % 2 ? 'bg-slate-50/70' : ''}`} />
                {/* window from withdraw-by to the payment */}
                <span
                  className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${tone.bar}`}
                  style={{ left: x(item.deadline), width: `calc(${x(lastPay)} - ${x(item.deadline)})` }}
                />
                {/* withdraw-by marker + label */}
                <span
                  className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-white ${tone.ring}`}
                  style={{ left: x(item.deadline) }}
                  title={`Withdraw by ${dayLabel(item.deadline)}`}
                />
                <span
                  className="absolute top-1/2 -translate-x-full -translate-y-1/2 pr-2.5 text-[11px] font-semibold tabular-nums text-slate-700"
                  style={{ left: x(item.deadline) }}
                >
                  {short(item.deadline)}
                </span>
                {/* payment markers */}
                {item.covers.map((c) => (
                  <span
                    key={`${c.obligationId}-${c.occurrenceIndex}`}
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white bg-sky-600 shadow-sm"
                    style={{ left: x(c.dueDate) }}
                    title={`${nameOf(c.obligationId, labels)} due ${dayLabel(c.dueDate)}`}
                  />
                ))}
                <span className="absolute top-1/2 -translate-y-1/2 pl-2.5 text-[11px] tabular-nums text-sky-800" style={{ left: x(lastPay) }}>
                  {short(lastPay)}
                  {item.covers.length > 1 ? ` · ${item.covers.length} payments` : ''}
                </span>
              </div>
            );
          })}
        </div>
        <span className="absolute -bottom-5 left-0 -translate-x-1/2 text-[11px] font-semibold text-slate-800">Today</span>
      </div>
      <div className="h-5" />
    </div>
  );
}
