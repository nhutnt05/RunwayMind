// Navigation performance: concurrent API requests share one chain read; results are reused only briefly; failures
// are never cached.
import { describe, expect, it } from 'vitest';
import { ReadCoalescer, SNAPSHOT_TTL_MS } from '../src/services/chain';

describe('ReadCoalescer', () => {
  it('runs one load for concurrent callers and returns the same value to all of them', async () => {
    let calls = 0;
    let release!: (v: number) => void;
    const c = new ReadCoalescer<number>(1_000, () => 0);
    const load = () => {
      calls++;
      return new Promise<number>((r) => (release = r));
    };
    const all = Promise.all([c.get(load), c.get(load), c.get(load)]);
    release(42);
    expect(await all).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('reuses the value within the TTL and reloads after it', async () => {
    let now = 0;
    let n = 0;
    const c = new ReadCoalescer<number>(1_000, () => now);
    const load = async () => ++n;
    expect(await c.get(load)).toBe(1);
    now = 999;
    expect(await c.get(load)).toBe(1);
    now = 1_000;
    expect(await c.get(load)).toBe(2);
  });

  it('never caches a failure: the next call loads again', async () => {
    let n = 0;
    const c = new ReadCoalescer<number>(1_000, () => 0);
    await expect(c.get(async () => Promise.reject(new Error('rpc down')))).rejects.toThrow('rpc down');
    expect(await c.get(async () => ++n)).toBe(1);
  });

  it('keeps API snapshots fresher than the 5 s UI refresh', () => {
    expect(SNAPSHOT_TTL_MS).toBeLessThan(5_000);
  });
});
