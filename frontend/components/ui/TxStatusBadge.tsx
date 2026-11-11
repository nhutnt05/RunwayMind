import type { TransactionStatus } from '@runwaymind/shared';

const STYLE: Record<TransactionStatus, { cls: string; icon: string; label: string }> = {
  PENDING: { cls: 'bg-sky-100 text-sky-800', icon: '◌', label: 'Pending' },
  CONFIRMED: { cls: 'bg-emerald-100 text-emerald-800', icon: '✓', label: 'Confirmed' },
  REVERTED: { cls: 'bg-red-100 text-red-800', icon: '✕', label: 'Reverted' },
  FAILED: { cls: 'bg-red-100 text-red-800', icon: '!', label: 'Failed' },
  DROPPED: { cls: 'bg-slate-100 text-slate-700', icon: '–', label: 'Dropped' },
};

export function TxStatusBadge({ status }: { status: TransactionStatus }) {
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      <span aria-hidden className={status === 'PENDING' ? 'inline-block animate-spin' : undefined}>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}
