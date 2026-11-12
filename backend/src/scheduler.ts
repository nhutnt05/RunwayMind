// Background loops (docs/14 §1 scheduler.ts): agent tick (docs/05 §2), keeper (docs/05 §10.1), event indexer
// (docs/07 §6). `/agent/evaluate` and scheduled ticks share one mutex (docs/07 §7): one tick at a time.
import type { Address } from 'viem';
import type { AgentLoop, Keeper, KeeperRunResult, Logger, TickResult } from '@runwaymind/agent';
import { silentLogger } from '@runwaymind/agent';
import type { AgentSettings } from '@runwaymind/shared';

/** Serializes async work (one tick at a time). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  private held = false;

  get locked(): boolean {
    return this.held;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      this.held = true;
      try {
        return await fn();
      } finally {
        this.held = false;
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export interface SchedulerDeps {
  /** null when AGENT_ENABLED=false. */
  loop: Pick<AgentLoop, 'tick'> | null;
  /** AGENT executor; null when AGENT_PRIVATE_KEY is unset (decisions stay APPROVED until it is configured). */
  executor: { enqueue(decisionId: string): Promise<unknown>; address?: Address } | null;
  /** null when KEEPER_ENABLED=false or KEEPER_PRIVATE_KEY is unset. */
  keeper: Pick<Keeper, 'tick' | 'address'> | null;
  indexer: { poll(): Promise<unknown> } | null;
  getSettings(): Promise<AgentSettings>;
  /** APPROVED decisions left over from a previous process (re-enqueued on start). */
  approvedDecisionIds?: () => Promise<string[]>;
  getBalance?: (address: Address) => Promise<bigint>;
  keeperIntervalMs?: number;
  indexerIntervalMs?: number;
  log?: Logger;
  now?: () => Date;
}

export interface KeeperStatusView {
  keeperAddress: Address | null;
  avaxBalance: bigint | null;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastResult: KeeperRunResult | null;
  lastError: string | null;
}

export const DEFAULT_KEEPER_INTERVAL_MS = 10_000;
export const DEFAULT_INDEXER_INTERVAL_MS = 10_000; // docs/07 §6: poll every 10 s

export function createScheduler(deps: SchedulerDeps) {
  const log = deps.log ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const tickMutex = new Mutex();
  const keeperMutex = new Mutex();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let running = false;

  const keeperState: { lastRunAt: Date | null; nextRunAt: Date | null; lastResult: KeeperRunResult | null; lastError: string | null } = {
    lastRunAt: null,
    nextRunAt: null,
    lastResult: null,
    lastError: null,
  };
  let lastTick: { at: Date; result: TickResult | null; error: string | null } | null = null;
  let nextTickAt: Date | null = null;

  function evaluate(): Promise<TickResult> {
    if (!deps.loop) return Promise.reject(new Error('AGENT_DISABLED'));
    const loop = deps.loop;
    return tickMutex.run(async () => {
      try {
        const result = await loop.tick();
        lastTick = { at: now(), result, error: null };
        return result;
      } catch (e) {
        lastTick = { at: now(), result: null, error: (e as Error).message };
        throw e;
      }
    });
  }

  function runKeeper(): Promise<KeeperRunResult> {
    if (!deps.keeper) return Promise.reject(new Error('KEEPER_DISABLED'));
    const keeper = deps.keeper;
    return keeperMutex.run(async () => {
      try {
        const result = await keeper.tick();
        Object.assign(keeperState, { lastRunAt: result.finishedAt, lastResult: result, lastError: result.errors.length ? JSON.stringify(result.errors[0]) : null });
        return result;
      } catch (e) {
        Object.assign(keeperState, { lastRunAt: now(), lastError: (e as Error).message });
        throw e;
      }
    });
  }

  /** Re-arming timer: the delay is re-read every round (agent interval comes from AgentSettings). */
  function every(name: string, delayMs: () => Promise<number> | number, fn: () => Promise<unknown>, onArm?: (at: Date) => void) {
    const arm = async () => {
      if (!running) return;
      const ms = await Promise.resolve(delayMs()).catch(() => 30_000);
      onArm?.(new Date(now().getTime() + ms));
      const t = setTimeout(async () => {
        timers.delete(t);
        try {
          await fn();
        } catch (e) {
          log.error(`${name} failed`, { error: (e as Error).message });
        }
        void arm();
      }, ms);
      timers.add(t);
    };
    void arm();
  }

  return {
    evaluate,
    runKeeper,
    enqueue(decisionId: string) {
      return deps.executor ? deps.executor.enqueue(decisionId) : Promise.resolve(null);
    },
    get agentEnabled() {
      return deps.loop !== null;
    },
    get executorEnabled() {
      return deps.executor !== null;
    },
    get keeperEnabled() {
      return deps.keeper !== null;
    },
    get agentAddress(): Address | null {
      return deps.executor?.address ?? null;
    },
    get tickInProgress() {
      return tickMutex.locked;
    },
    agentStatus() {
      return { enabled: deps.loop !== null, executorEnabled: deps.executor !== null, lastTick, nextTickAt };
    },

    async keeperStatus(): Promise<KeeperStatusView> {
      const address = deps.keeper?.address ?? null;
      let avaxBalance: bigint | null = null;
      if (address && deps.getBalance) avaxBalance = await deps.getBalance(address).catch(() => null);
      return { keeperAddress: address, avaxBalance, enabled: deps.keeper !== null, ...keeperState };
    },

    async start() {
      if (running) return;
      running = true;
      if (deps.executor && deps.approvedDecisionIds) {
        for (const id of await deps.approvedDecisionIds()) void deps.executor.enqueue(id);
      }
      if (deps.loop) {
        every(
          'agent tick',
          async () => (await deps.getSettings()).loopIntervalSec * 1000,
          () => evaluate(),
          (at) => (nextTickAt = at),
        );
      }
      if (deps.keeper) {
        every('keeper', () => deps.keeperIntervalMs ?? DEFAULT_KEEPER_INTERVAL_MS, () => runKeeper(), (at) => (keeperState.nextRunAt = at));
      }
      if (deps.indexer) {
        const indexer = deps.indexer;
        every('indexer', () => deps.indexerIntervalMs ?? DEFAULT_INDEXER_INTERVAL_MS, () => indexer.poll());
      }
    },

    stop() {
      running = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
