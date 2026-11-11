import { describe, expect, it, vi } from 'vitest';
import { createTxTracker } from '../lib/txTracker';

describe('tx tracker store (docs/08 §5 useTxTracker)', () => {
  it('upserts by id, newest first, and notifies subscribers', () => {
    let t = 0;
    const tracker = createTxTracker(() => ++t);
    const listener = vi.fn();
    tracker.subscribe(listener);

    tracker.upsert({ id: 'a', title: 'Create obligation', status: 'PENDING' });
    tracker.upsert({ id: 'b', title: 'Approve', status: 'PENDING' });
    tracker.upsert({ id: 'a', status: 'CONFIRMED', hash: `0x${'1'.repeat(64)}` });

    const items = tracker.getSnapshot();
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(items[1]).toMatchObject({ title: 'Create obligation', status: 'CONFIRMED', updatedAt: 3 });
    expect(listener).toHaveBeenCalledTimes(3);

    tracker.dismiss('b');
    expect(tracker.getSnapshot().map((i) => i.id)).toEqual(['a']);
  });

  it('returns a stable snapshot between updates (useSyncExternalStore contract)', () => {
    const tracker = createTxTracker();
    const s1 = tracker.getSnapshot();
    expect(tracker.getSnapshot()).toBe(s1);
    tracker.upsert({ id: 'x' });
    expect(tracker.getSnapshot()).not.toBe(s1);
  });
});
