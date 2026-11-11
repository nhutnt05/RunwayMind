'use client';

import { useEffect } from 'react';
import { SnowtraceLink, TxStatusBadge } from '@/components/ui';
import { useTxTracker } from '@/hooks/useTxTracker';
import type { TxToastItem } from '@/lib/txTracker';

const AUTO_DISMISS_MS = 15_000;

/** One transaction toast: pending spinner → confirmed ✓ with Snowtrace link; red with decoded error on revert. */
export function TxToast({ item, onDismiss }: { item: TxToastItem; onDismiss: () => void }) {
  const failed = item.status === 'REVERTED' || item.status === 'FAILED';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`pointer-events-auto w-full rounded-lg border bg-white p-3 text-sm shadow-lg ${
        failed ? 'border-red-300' : item.status === 'CONFIRMED' ? 'border-emerald-300' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{item.title}</p>
            <TxStatusBadge status={item.status} />
          </div>
          {item.message ? (
            <p className={`mt-1 break-words text-xs ${failed ? 'text-red-800' : 'text-slate-600'}`}>{item.message}</p>
          ) : null}
          {item.hash ? (
            <p className="mt-1">
              <SnowtraceLink kind="tx" value={item.hash}>
                View on Snowtrace
              </SnowtraceLink>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          aria-label={`Dismiss ${item.title} notification`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Fixed-position stack of TxToasts fed by the tx tracker store. Confirmed toasts auto-dismiss after 15 s. */
export function TxToastViewport() {
  const { items, dismiss } = useTxTracker();

  useEffect(() => {
    const timers = items
      .filter((t) => t.status === 'CONFIRMED' || t.status === 'DROPPED')
      .map((t) => setTimeout(() => dismiss(t.id), Math.max(0, AUTO_DISMISS_MS - (Date.now() - t.updatedAt))));
    return () => timers.forEach(clearTimeout);
  }, [items, dismiss]);

  if (items.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 lg:bottom-4"
    >
      {items.slice(0, 5).map((t) => (
        <TxToast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
