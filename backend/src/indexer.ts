// Event indexer (docs/07 §6): polls `getLogs` from `ChainEventCursor.lastBlock` for the tracked Treasury/Registry
// events, upserts IndexedEvent rows (principal accounting for accruedYield, payment history) and Transaction rows.
// The chain remains the source of truth; re-indexing the same range is idempotent (ids are `${txHash}:${logIndex}`).
import { erc20Abi, parseEventLogs, type Address, type Hex, type Log, type PublicClient } from 'viem';
import { treasuryAbi } from '@runwaymind/shared/abi';
import { decodeTrackedLogs, kindFromEvents, silentLogger, type CoreAddresses, type DecodedEvent, type Logger } from '@runwaymind/agent';
import type { TransactionKind } from '@runwaymind/shared';
import type { Repositories } from './repositories';

export interface IndexerDeps {
  client: PublicClient;
  addresses: Pick<CoreAddresses, 'treasury' | 'registry'>;
  /** Treasury asset (ERC-20) — used to measure liquidity pulled from adapters inside pay(). */
  asset: Address;
  repos: Pick<Repositories, 'eventCursor' | 'setEventCursor' | 'upsertIndexedEvent' | 'upsertTransaction'>;
  /** First block to index when no cursor exists (TreasuryConfig.deployBlock). */
  startBlock: bigint;
  /** Max blocks per getLogs call (public Fuji RPC limit is 2,048). */
  chunkSize?: bigint;
  /** Max chunks per poll, so one poll never blocks for long while catching up. */
  maxChunksPerPoll?: number;
  log?: Logger;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Liquidity pulled from adapters inside `pay()` for one transaction: asset transferred INTO the Treasury, minus the
 * amounts already accounted by `Withdrawn` / `DeadlineEnforced` events of the same transaction (never negative).
 */
export function pulledIntoTreasury(logs: readonly Log[], asset: Address, treasury: Address, events: readonly DecodedEvent[]): bigint {
  const transfers = parseEventLogs({ abi: erc20Abi, logs: logs.filter((l) => same(l.address, asset)) as Log[], eventName: 'Transfer', strict: false });
  let inflow = 0n;
  for (const t of transfers) {
    const args = t.args as { from?: Address; to?: Address; value?: bigint };
    if (args.to && same(args.to, treasury) && args.from && !same(args.from, treasury)) inflow += args.value ?? 0n;
  }
  let accounted = 0n;
  for (const e of events) {
    if (e.name === 'Withdrawn') accounted += BigInt(String(e.args.received ?? '0'));
    if (e.name === 'DeadlineEnforced') accounted += BigInt(String(e.args.withdrawn ?? '0'));
  }
  return inflow > accounted ? inflow - accounted : 0n;
}

export function createIndexer(deps: IndexerDeps) {
  const chunk = deps.chunkSize ?? 2_000n;
  const maxChunks = deps.maxChunksPerPoll ?? 10;
  const log = deps.log ?? silentLogger;
  const treasury = { address: deps.addresses.treasury, abi: treasuryAbi } as const;

  /** Treasury chain time (block.timestamp + demo offset) at a block — rule 3: time comes from currentTime(). */
  async function chainTimeAt(blockNumber: bigint): Promise<number | null> {
    try {
      return Number(await deps.client.readContract({ ...treasury, functionName: 'currentTime', blockNumber }));
    } catch {
      return null;
    }
  }

  async function indexRange(fromBlock: bigint, toBlock: bigint): Promise<number> {
    const logs = await deps.client.getLogs({
      address: [deps.addresses.treasury, deps.addresses.registry],
      fromBlock,
      toBlock,
    });
    const events = decodeTrackedLogs(logs, deps.addresses);
    if (events.length === 0) return 0;

    const byTx = new Map<Hex, DecodedEvent[]>();
    for (const e of events) byTx.set(e.txHash, [...(byTx.get(e.txHash) ?? []), e]);
    const times = new Map<bigint, number | null>();
    for (const b of new Set(events.map((e) => e.blockNumber))) times.set(b, await chainTimeAt(b));

    for (const [hash, txEvents] of byTx) {
      const receipt = await deps.client.getTransactionReceipt({ hash });
      const paid = txEvents.filter((e) => e.name === 'ObligationPaid');
      if (paid.length) {
        // _pullLiquidity emits no per-adapter event: measure it from the receipt, attribute it to the first payment.
        const pulled = pulledIntoTreasury(receipt.logs, deps.asset, deps.addresses.treasury, txEvents);
        paid.forEach((e, i) => (e.args = { ...e.args, pulled: (i === 0 ? pulled : 0n).toString() }));
      }
      for (const e of txEvents) {
        await deps.repos.upsertIndexedEvent({
          id: `${e.txHash}:${e.logIndex}`,
          name: e.name,
          blockNumber: e.blockNumber,
          txHash: e.txHash,
          args: e.args,
          chainTime: times.get(e.blockNumber) ?? null,
        });
      }
      await deps.repos.upsertTransaction({
        hash,
        kind: kindFromEvents(txEvents.map((e) => e.name)) as TransactionKind,
        from: receipt.from,
        initiator: 'INDEXER',
        status: receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED',
        blockNumber: receipt.blockNumber,
        decodedEvents: txEvents,
        error: null,
        relatedId: null,
        confirmedAt: new Date(),
      });
    }
    return events.length;
  }

  return {
    /** One poll: indexes from the cursor up to the head (bounded by `maxChunksPerPoll`). Returns events indexed. */
    async poll(): Promise<{ fromBlock: bigint; toBlock: bigint; events: number } | null> {
      const head = await deps.client.getBlockNumber({ cacheTime: 0 });
      const cursor = await deps.repos.eventCursor();
      let from = cursor === null ? deps.startBlock : cursor + 1n;
      if (from > head) return null;
      const start = from;
      let total = 0;
      for (let i = 0; i < maxChunks && from <= head; i++) {
        const to = from + chunk - 1n < head ? from + chunk - 1n : head;
        total += await indexRange(from, to);
        await deps.repos.setEventCursor(to);
        from = to + 1n;
      }
      if (total) log.info('indexed events', { fromBlock: start, toBlock: from - 1n, events: total });
      return { fromBlock: start, toBlock: from - 1n, events: total };
    },
  };
}

export type Indexer = ReturnType<typeof createIndexer>;
