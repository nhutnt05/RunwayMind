// Pending-transaction / toast store (docs/08 §5 "useTxTracker"). A tiny external store consumed with
// useSyncExternalStore — equivalent to the zustand store named in the spec without adding a dependency.
import type { TransactionStatus } from '@runwaymind/shared';

export interface TxToastItem {
  id: string;
  title: string;
  status: TransactionStatus;
  hash?: `0x${string}`;
  message?: string;
  updatedAt: number;
}

type Listener = () => void;

export function createTxTracker(now: () => number = () => Date.now()) {
  let items: readonly TxToastItem[] = [];
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  return {
    getSnapshot: () => items,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Insert or merge by id (newest first). */
    upsert(patch: Partial<TxToastItem> & { id: string }) {
      const existing = items.find((t) => t.id === patch.id);
      const next: TxToastItem = {
        title: 'Transaction',
        status: 'PENDING',
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      items = existing ? items.map((t) => (t.id === patch.id ? next : t)) : [next, ...items];
      emit();
    },
    dismiss(id: string) {
      items = items.filter((t) => t.id !== id);
      emit();
    },
    clear() {
      items = [];
      emit();
    },
  };
}

export type TxTracker = ReturnType<typeof createTxTracker>;

/** Toast lifetimes: errors close after 5 s, confirmed/dropped after 15 s; pending/submitted stay until resolved. */
export const TOAST_DISMISS_MS = { error: 5_000, done: 15_000 } as const;

/** Milliseconds left before a toast closes on its own, or null when it stays (still in flight). */
export function autoDismissDelay(item: Pick<TxToastItem, 'status' | 'updatedAt'>, now: number): number | null {
  const total =
    item.status === 'REVERTED' || item.status === 'FAILED'
      ? TOAST_DISMISS_MS.error
      : item.status === 'CONFIRMED' || item.status === 'DROPPED'
        ? TOAST_DISMISS_MS.done
        : null;
  return total === null ? null : Math.max(0, total - (now - item.updatedAt));
}

export const txTracker = createTxTracker();

let seq = 0;
export function newToastId(prefix = 'tx'): string {
  seq += 1;
  return `${prefix}-${seq}`;
}
