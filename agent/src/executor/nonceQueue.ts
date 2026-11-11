// Single in-process queue per signing key (docs/05 §10 step 3): executions are serialized and nonces are assigned
// locally so that back-to-back transactions never collide. On any send failure the nonce is re-synced from the node.
import type { Address, PublicClient } from 'viem';

export class NonceQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private nonce: number | null = null;
  private depth = 0;

  constructor(
    private readonly client: PublicClient,
    readonly address: Address,
  ) {}

  /** Runs `fn` after every previously queued job has settled (FIFO, one at a time). */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth += 1;
    const job = this.tail.then(fn, fn);
    this.tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job.finally(() => {
      this.depth -= 1;
    });
  }

  /** Jobs queued or running. */
  get pending(): number {
    return this.depth;
  }

  /** Next nonce for `address` (pending block tag on first use / after a reset). Call only inside `run`. */
  async next(): Promise<number> {
    if (this.nonce === null) {
      this.nonce = await this.client.getTransactionCount({ address: this.address, blockTag: 'pending' });
    }
    const n = this.nonce;
    this.nonce += 1;
    return n;
  }

  /** Forget the local nonce; the next call re-reads it from the node. */
  reset(): void {
    this.nonce = null;
  }
}
