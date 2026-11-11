'use client';

import { useSyncExternalStore } from 'react';
import { txTracker, type TxTracker } from '@/lib/txTracker';

/** Subscribe to the pending-tx / toast store (docs/08 §5). */
export function useTxTracker(tracker: TxTracker = txTracker) {
  const items = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
  return { items, upsert: tracker.upsert, dismiss: tracker.dismiss };
}
