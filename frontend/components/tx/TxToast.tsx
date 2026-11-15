'use client';

import { useEffect, useState } from 'react';
import { SnowtraceLink, TxStatusBadge } from '@/components/ui';
import { useTxTracker } from '@/hooks/useTxTracker';
import { autoDismissDelay, type TxToastItem } from '@/lib/txTracker';

/** One transaction toast: pending spinner → confirmed ✓ with Snowtrace link; red with decoded error on revert. */
export function TxToast({ item, onDismiss }: { item: TxToastItem; onDismiss: () => void }) {
  const failed = item.status === 'REVERTED' || item.status === 'FAILED';
  // Auto-close (errors 5 s, confirmed 15 s). Hover or keyboard focus pauses it so a message can be read to the end;
  // leaving restarts the full time. The ✕ button always closes immediately.
  const [paused, setPaused] = useState(false);
  const [resumedAt, setResumedAt] = useState(0);
  useEffect(() => {
    if (paused) return;
    const left = autoDismissDelay({ status: item.status, updatedAt: Math.max(item.updatedAt, resumedAt) }, Date.now());
    if (left === null) return;
    const timer = setTimeout(onDismiss, left);
    return () => clearTimeout(timer);
  }, [item.status, item.updatedAt, resumedAt, paused, onDismiss]);
  const resume = () => {
    setPaused(false);
    setResumedAt(Date.now());
  };
  return (
    <div
      data-testid="tx-toast"
      data-status={item.status}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={resume}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
      }}
      // Pending / confirmed updates are announced politely by the viewport's live region; failures interrupt.
      role={failed ? 'alert' : undefined}
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

/**
 * Fixed-position stack of TxToasts fed by the tx tracker store. Errors auto-dismiss after
 * TOAST_DISMISS_MS.error, confirmed/dropped after TOAST_DISMISS_MS.done (paused while hovered or focused).
 */
export function TxToastViewport() {
  const { items, dismiss } = useTxTracker();

  // The live region is always mounted (even when empty) so screen readers announce the first pending toast; a live
  // region inserted together with its content is often not announced.
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
