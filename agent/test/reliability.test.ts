// D7-B1 reliability pass (docs/01 §9, docs/05 §10–§12) without a chain: fake PublicClient / wallet drive the real
// executor, keeper and RPC transport through every error path (nonce conflicts, send retries, reverted receipts,
// simulation reverts, keeper InsufficientLiquidity → enforceDeadlines → retry, keeper delay catch-up, RPC fallback,
// expired approvals). Every path also checks the AuditLog rows of docs/05 §11.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContractFunctionRevertedError,
  NonceTooLowError,
  encodeErrorResult,
  encodeEventTopics,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { treasuryAbi } from '@runwaymind/shared/abi';
import { AuditLogger, MemoryAuditSink, type Logger } from '../src/audit/audit';
import { RPC_RETRY_COUNT, createChainPublicClient } from '../src/chain/clients';
import { ALL_ERRORS_ABI } from '../src/chain/errors';
import { Executor } from '../src/executor/executor';
import { DEFAULT_RETRY_DELAYS_MS, withRetry, type AgentWallet } from '../src/executor/send';
import { MAX_PAYS_PER_TICK, createKeeper } from '../src/keeper/keeper';
import { createApprovalService } from '../src/orchestrator/approval';
import { MemoryAgentStore, type DecisionRecord } from '../src/orchestrator/store';
import { createAgentLoop } from '../src/orchestrator/tick';
import { ADAPTER, DAY, T0, USDC, snapshot } from './fixtures';

const TREASURY: Address = '0x00000000000000000000000000000000000000f1';
const REGISTRY: Address = '0x00000000000000000000000000000000000000f3';
const ADDRS = { treasury: TREASURY, registry: REGISTRY, policy: '0x00000000000000000000000000000000000000f4' as Address };
const SIGNER: Address = '0x00000000000000000000000000000000000000e1';
const NO_DELAY = [0, 0, 0] as const;

function revert(errorName: string, args: readonly unknown[], functionName = 'invest') {
  const data = encodeErrorResult({ abi: ALL_ERRORS_ABI, errorName, args } as never);
  return new ContractFunctionRevertedError({ abi: ALL_ERRORS_ABI, data, functionName });
}

const hashOf = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;

interface WriteReq {
  functionName: string;
  args?: readonly unknown[];
  nonce: number;
}

/** Programmable chain double: only the methods executor / keeper / NonceQueue call. */
function fakeChain() {
  const st = {
    nodeNonce: 5,
    nonceReads: 0,
    writes: [] as WriteReq[],
    sims: [] as { functionName: string; args?: readonly unknown[] }[],
    receiptStatus: 'success' as 'success' | 'reverted',
    logs: [] as unknown[],
    simulate: (_req: { functionName: string; args?: readonly unknown[] }): void => undefined,
    write: (req: WriteReq): Hex => hashOf(req.nonce + 1),
    read: (_fn: string, _args?: readonly unknown[]): unknown => undefined,
  };
  const client = {
    getTransactionCount: async () => {
      st.nonceReads += 1;
      return st.nodeNonce;
    },
    simulateContract: async (req: { functionName: string; args?: readonly unknown[] }) => {
      st.sims.push({ functionName: req.functionName, ...(req.args ? { args: req.args } : {}) });
      st.simulate(req);
      return { request: req, result: undefined };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
      status: st.receiptStatus,
      logs: st.logs.map((l) => ({ ...(l as object), transactionHash: hash })),
      blockNumber: 100n,
      gasUsed: 21_000n,
    }),
    getBlockNumber: async () => 100n,
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => st.read(functionName, args),
  } as unknown as PublicClient;
  const wallet = {
    account: { address: SIGNER },
    writeContract: async (req: WriteReq) => {
      st.writes.push(req);
      return st.write(req);
    },
  } as unknown as AgentWallet;
  return { st, client, wallet };
}

const breakerLog = () => ({
  address: TREASURY,
  topics: encodeEventTopics({ abi: treasuryAbi, eventName: 'CircuitBreakerTripped', args: { by: SIGNER } } as never),
  data: '0x',
  logIndex: 0,
  blockNumber: 100n,
});

async function approvedDecision(store: MemoryAgentStore, d: Partial<DecisionRecord> = {}) {
  return store.createDecision({
    snapshotId: 'snap',
    action: 'TRIP_CIRCUIT_BREAKER',
    adapter: null,
    amount: null,
    reasonCode: 'MANUAL',
    status: 'APPROVED',
    mode: 'APPROVE',
    facts: {} as never,
    explanation: null,
    expiresAt: new Date(Date.now() + 600_000),
    ...d,
  });
}

function executorSetup() {
  const chain = fakeChain();
  const store = new MemoryAgentStore();
  const sink = new MemoryAuditSink();
  const executor = new Executor({
    client: chain.client,
    wallet: chain.wallet,
    addresses: ADDRS,
    store,
    audit: new AuditLogger(sink),
    retryDelaysMs: NO_DELAY,
    readSnapshot: async () => snapshot(),
  });
  const events = () => sink.entries.map((e) => e.eventType);
  return { ...chain, store, sink, executor, events };
}

describe('executor error paths (docs/01 §9, docs/05 §10)', () => {
  it('retry schedule is 2 s / 4 s / 8 s and withRetry gives up after 3 retries', async () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([2_000, 4_000, 8_000]);
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error('network');
      }, NO_DELAY),
    ).rejects.toThrow('network');
    expect(calls).toBe(4);
  });

  it('nonce conflict: "nonce too low" → nonce re-synced from the node, resent once, EXECUTED', async () => {
    const t = executorSetup();
    t.st.logs = [breakerLog()];
    t.st.write = (req) => {
      if (t.st.writes.length === 1) {
        t.st.nodeNonce = 6; // another tx from the same key consumed nonce 5
        throw new NonceTooLowError();
      }
      return hashOf(req.nonce + 1);
    };
    const d = await approvedDecision(t.store);
    const res = await t.executor.enqueue(d.id);
    expect(res?.status).toBe('EXECUTED');
    expect(t.st.writes.map((w) => w.nonce)).toEqual([5, 6]);
    expect(t.st.nonceReads).toBe(2);
    const [action] = await t.store.listActions(d.id);
    expect(action).toMatchObject({ status: 'CONFIRMED', attempt: 2, txHash: hashOf(7) });
    expect(t.events()).toEqual(['ACTION_SENT', 'ACTION_CONFIRMED']);
  });

  it('back-to-back executions get consecutive nonces without re-reading the node', async () => {
    const t = executorSetup();
    t.st.logs = [breakerLog()];
    const a = await approvedDecision(t.store);
    const b = await approvedDecision(t.store);
    const res = await Promise.all([t.executor.enqueue(a.id), t.executor.enqueue(b.id)]);
    expect(res.map((r) => r?.status)).toEqual(['EXECUTED', 'EXECUTED']);
    expect(t.st.writes.map((w) => w.nonce)).toEqual([5, 6]);
    expect(t.st.nonceReads).toBe(1);
  });

  it('send failure: network error on every attempt → 1 + 3 retries, then FAILED + ACTION_FAILED', async () => {
    const t = executorSetup();
    t.st.write = () => {
      throw new Error('fetch failed');
    };
    const d = await approvedDecision(t.store);
    const res = await t.executor.enqueue(d.id);
    expect(res?.status).toBe('FAILED');
    expect(t.st.writes).toHaveLength(4);
    const [action] = await t.store.listActions(d.id);
    expect(action).toMatchObject({ status: 'FAILED', decodedError: { name: 'SEND_FAILED' } });
    expect(t.sink.entries.at(-1)).toMatchObject({ eventType: 'ACTION_FAILED', payload: { stage: 'SEND' }, entityId: d.id });
  });

  it('receipt reverted → action REVERTED, decision FAILED, ACTION_FAILED; never re-sent', async () => {
    const t = executorSetup();
    t.st.receiptStatus = 'reverted';
    const d = await approvedDecision(t.store);
    const res = await t.executor.enqueue(d.id);
    expect(res?.status).toBe('FAILED');
    expect(t.st.writes).toHaveLength(1);
    const [action] = await t.store.listActions(d.id);
    expect(action).toMatchObject({ status: 'REVERTED', decodedError: { name: 'TransactionReverted' } });
    expect(t.store.transactions.get(hashOf(6))).toMatchObject({ status: 'REVERTED' });
    expect(t.events()).toEqual(['ACTION_SENT', 'ACTION_FAILED']);
    expect(t.sink.entries[1]!.payload).toMatchObject({ reverted: true });
  });

  it('simulation revert with a policy error → BLOCKED_BY_POLICY, nothing sent, ACTION_SIMULATION_REVERTED', async () => {
    const t = executorSetup();
    t.st.simulate = () => {
      throw revert('ReserveViolation', [USDC(10_000), USDC(30_000)]);
    };
    const d = await approvedDecision(t.store, { action: 'INVEST', adapter: ADAPTER, amount: USDC(90_000) });
    const res = await t.executor.enqueue(d.id);
    expect(res?.status).toBe('BLOCKED_BY_POLICY');
    expect(t.st.writes).toHaveLength(0);
    expect(t.st.sims).toHaveLength(1); // reverts are not retried
    const [action] = await t.store.listActions(d.id);
    expect(action).toMatchObject({ status: 'BLOCKED_BY_POLICY', decodedError: { name: 'ReserveViolation', args: { idleAfter: '10000000000' } } });
    expect(t.events()).toEqual(['ACTION_SIMULATION_REVERTED']);
  });

  it('simulation revert outside the policy set → FAILED with both audit rows', async () => {
    const t = executorSetup();
    t.st.simulate = () => {
      throw revert('ZeroAmount', []);
    };
    const d = await approvedDecision(t.store, { action: 'INVEST', adapter: ADAPTER, amount: 1n });
    expect((await t.executor.enqueue(d.id))?.status).toBe('FAILED');
    expect(t.events()).toEqual(['ACTION_SIMULATION_REVERTED', 'ACTION_FAILED']);
  });

  it('transient RPC error during simulation is retried, then executes', async () => {
    const t = executorSetup();
    t.st.logs = [breakerLog()];
    let n = 0;
    t.st.simulate = () => {
      n += 1;
      if (n === 1) throw new Error('timeout');
    };
    const d = await approvedDecision(t.store);
    expect((await t.executor.enqueue(d.id))?.status).toBe('EXECUTED');
    expect(t.st.sims).toHaveLength(2);
  });

  it('crash inside execute (snapshot read fails) → FAILED + ACTION_FAILED EXECUTOR_ERROR, queue keeps working', async () => {
    const t = executorSetup();
    const executor = new Executor({
      client: t.client,
      wallet: t.wallet,
      addresses: ADDRS,
      store: t.store,
      audit: new AuditLogger(t.sink),
      retryDelaysMs: NO_DELAY,
      readSnapshot: async () => {
        throw new Error('rpc down');
      },
    });
    const d = await approvedDecision(t.store);
    expect((await executor.enqueue(d.id))?.status).toBe('FAILED');
    expect(t.sink.entries.at(-1)).toMatchObject({ eventType: 'ACTION_FAILED', payload: { reason: 'EXECUTOR_ERROR' } });
  });
});

// ---- keeper -----------------------------------------------------------------------------------------------------

interface RawOb {
  id: bigint;
  recipient: Address;
  amount: bigint;
  nextDueDate: bigint;
  interval: bigint;
  maxOccurrences: number;
  paidOccurrences: number;
  category: number;
  status: number;
  metadataHash: Hex;
  createdAt: bigint;
}

function keeperSetup(opts: { chainTime: number; shortfall?: bigint; obligations: Partial<RawOb>[] }) {
  const chain = fakeChain();
  const store = new MemoryAgentStore();
  const sink = new MemoryAuditSink();
  const alerts: string[] = [];
  const log: Logger = { info: () => undefined, warn: () => undefined, error: (m) => void alerts.push(m) };
  const obs = new Map<bigint, RawOb>(
    opts.obligations.map((o, i) => {
      const id = BigInt(i + 1);
      return [
        id,
        {
          id,
          recipient: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address,
          amount: USDC(20_000),
          nextDueDate: BigInt(T0 + 7 * DAY),
          interval: 0n,
          maxOccurrences: 1,
          paidOccurrences: 0,
          category: 0,
          status: 0,
          metadataHash: `0x${'0'.repeat(64)}`,
          createdAt: BigInt(T0),
          ...o,
        },
      ];
    }),
  );
  const state = { shortfall: opts.shortfall ?? 0n, liquidityShort: false, enforceFixes: true };
  chain.st.read = (fn, args) => {
    if (fn === 'currentTime') return BigInt(opts.chainTime);
    if (fn === 'shortfall') return state.shortfall;
    if (fn === 'getActiveObligationIds') return [...obs.values()].filter((o) => o.status === 0).map((o) => o.id);
    if (fn === 'getObligation') return obs.get(args![0] as bigint);
    throw new Error(`unexpected read ${fn}`);
  };
  chain.st.simulate = (req) => {
    if (req.functionName === 'pay' && state.liquidityShort) {
      const ob = obs.get(req.args![0] as bigint)!;
      throw revert('InsufficientLiquidity', [ob.amount, USDC(1_000)], 'pay');
    }
  };
  chain.st.write = (req) => {
    if (req.functionName === 'enforceDeadlines') {
      state.shortfall = 0n;
      if (state.enforceFixes) state.liquidityShort = false;
    }
    if (req.functionName === 'pay') {
      const ob = obs.get(req.args![0] as bigint)!;
      ob.paidOccurrences += 1;
      if (ob.maxOccurrences !== 0 && ob.paidOccurrences >= ob.maxOccurrences) ob.status = 1;
      else ob.nextDueDate += ob.interval;
    }
    return hashOf(req.nonce + 1);
  };
  const keeper = createKeeper({ client: chain.client, wallet: chain.wallet, addresses: ADDRS, store, audit: new AuditLogger(sink), retryDelaysMs: NO_DELAY, log });
  const events = () => sink.entries.map((e) => e.eventType);
  return { ...chain, store, sink, keeper, obs, state, alerts, events };
}

describe('keeper error paths (docs/01 §9, docs/05 §10.1)', () => {
  it('shortfall > 0 → enforceDeadlines() first (R2), audited KEEPER_ENFORCE', async () => {
    const t = keeperSetup({ chainTime: T0 + DAY, shortfall: USDC(5_000), obligations: [] });
    const run = await t.keeper.tick();
    expect(run).toMatchObject({ enforced: true, shortfallBefore: USDC(5_000), errors: [], paidIds: [] });
    expect(t.events()).toEqual(['KEEPER_ENFORCE']);
    expect(t.store.keeperRuns.get(run.id)).toMatchObject({ enforced: true, txHashes: [hashOf(6)] });
  });

  it('pay() reverts InsufficientLiquidity → enforceDeadlines() → pay retried once and succeeds', async () => {
    const t = keeperSetup({ chainTime: T0 + 7 * DAY, obligations: [{}] });
    t.state.liquidityShort = true;
    const run = await t.keeper.tick();
    expect(run).toMatchObject({ enforced: true, paidIds: [1n], errors: [] });
    expect(t.st.sims.map((s) => s.functionName)).toEqual(['pay', 'enforceDeadlines', 'pay']);
    expect(t.st.writes.map((w) => [w.functionName, w.nonce])).toEqual([['enforceDeadlines', 5], ['pay', 6]]);
    expect(t.events()).toEqual(['KEEPER_ENFORCE', 'KEEPER_PAY']);
    expect(t.sink.entries[0]!.payload).toMatchObject({ trigger: 'PAY_INSUFFICIENT_LIQUIDITY', obligationId: 1n });
    expect(t.alerts).toEqual([]);
  });

  it('pay() still InsufficientLiquidity after enforceDeadlines → no further retry, error recorded, alert raised', async () => {
    const t = keeperSetup({ chainTime: T0 + 7 * DAY, obligations: [{}] });
    t.state.liquidityShort = true;
    t.state.enforceFixes = false; // e.g. the pool is paused (AdapterWithdrawFailed inside enforceDeadlines)
    const run = await t.keeper.tick();
    expect(run.paidIds).toEqual([]);
    expect(t.st.sims.filter((s) => s.functionName === 'pay')).toHaveLength(2);
    expect(run.errors).toEqual([{ step: 'pay', obligationId: '1', error: expect.objectContaining({ name: 'InsufficientLiquidity' }) }]);
    expect(t.alerts).toHaveLength(1);
    expect(t.events()).toEqual(['KEEPER_ENFORCE']);
    expect(t.store.keeperRuns.get(run.id)?.errors).toHaveLength(1);
  });

  it('other pay() reverts are not retried through enforceDeadlines', async () => {
    const t = keeperSetup({ chainTime: T0 + 7 * DAY, obligations: [{}] });
    t.st.simulate = (req) => {
      if (req.functionName === 'pay') throw revert('ObligationNotDue', [1n, BigInt(T0 + 7 * DAY), BigInt(T0)], 'pay');
    };
    const run = await t.keeper.tick();
    expect(t.st.sims.map((s) => s.functionName)).toEqual(['pay']);
    expect(run.errors[0]).toMatchObject({ step: 'pay', error: { name: 'ObligationNotDue' } });
    expect(t.events()).toEqual([]);
  });

  it('keeper delay: 7 overdue daily occurrences → 5 paid this tick (cap), the rest on the next tick', async () => {
    const t = keeperSetup({
      chainTime: T0 + 6 * DAY + 3_600,
      obligations: [{ nextDueDate: BigInt(T0), interval: BigInt(DAY), maxOccurrences: 0 }],
    });
    const first = await t.keeper.tick();
    expect(first.paidIds).toHaveLength(MAX_PAYS_PER_TICK);
    const second = await t.keeper.tick();
    expect(second.paidIds).toHaveLength(2);
    expect(t.obs.get(1n)!.nextDueDate).toBe(BigInt(T0 + 7 * DAY)); // caught up: next occurrence is in the future
    expect(t.st.writes.map((w) => w.nonce)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(t.events().filter((e) => e === 'KEEPER_PAY')).toHaveLength(7);
    const third = await t.keeper.tick();
    expect(third.paidIds).toEqual([]);
  });

  it('RPC read failure → run recorded with a read error, no throw', async () => {
    const t = keeperSetup({ chainTime: T0 + 7 * DAY, obligations: [{}] });
    const read = t.st.read;
    t.st.read = (fn, args) => {
      if (fn === 'getObligation') throw new Error('rate limited');
      return read(fn, args);
    };
    const run = await t.keeper.tick();
    expect(run.errors).toEqual([{ step: 'read', error: 'rate limited' }]);
    expect(t.store.keeperRuns.get(run.id)).toMatchObject({ errors: [{ step: 'read' }] });
  });
});

// ---- RPC fallback (docs/01 §9: viem fallback over 2 URLs, 3 retries) ---------------------------------------------

describe('RPC fallback transport', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  /** In-process JSON-RPC stub on an ephemeral port (never 3000 / 4000 / 8545). */
  async function rpcStub(handler: (method: string) => { status: number; result?: unknown }) {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const msg = JSON.parse(body) as { id: number; method: string };
        hits.push(msg.method);
        const out = handler(msg.method);
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(out.status === 200 ? JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: out.result }) : '{"error":"rate limited"}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    servers.push(server);
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits };
  }

  it('primary rate-limited (429) → request served by the fallback URL', async () => {
    const primary = await rpcStub(() => ({ status: 429 }));
    const backup = await rpcStub(() => ({ status: 200, result: '0x2a' }));
    const client = createChainPublicClient({ CHAIN_ID: 31337, FUJI_RPC_URL: primary.url, FUJI_RPC_URL_FALLBACK: backup.url });
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(42n);
    expect(primary.hits).toEqual(['eth_blockNumber']); // no per-URL retry: fails over immediately
    expect(backup.hits).toEqual(['eth_blockNumber']);
  });

  it('single URL: transient 503 is retried (up to 3 retries) and then succeeds', async () => {
    let n = 0;
    const only = await rpcStub(() => (++n < 3 ? { status: 503 } : { status: 200, result: '0x7' }));
    const client = createChainPublicClient({ CHAIN_ID: 31337, FUJI_RPC_URL: only.url, FUJI_RPC_URL_FALLBACK: undefined });
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(7n);
    expect(only.hits).toHaveLength(3);
    expect(RPC_RETRY_COUNT).toBe(3);
  });

  it('both URLs down → error after the retry budget (1 + 3 rounds over both URLs)', async () => {
    const primary = await rpcStub(() => ({ status: 503 }));
    const backup = await rpcStub(() => ({ status: 503 }));
    const client = createChainPublicClient({ CHAIN_ID: 31337, FUJI_RPC_URL: primary.url, FUJI_RPC_URL_FALLBACK: backup.url });
    await expect(client.getBlockNumber({ cacheTime: 0 })).rejects.toThrow();
    expect(primary.hits).toHaveLength(RPC_RETRY_COUNT + 1);
    expect(backup.hits).toHaveLength(RPC_RETRY_COUNT + 1);
  }, 15_000);
});

// ---- expired approvals (docs/05 §2.1, §8; TTL is wall-clock by design) -------------------------------------------

describe('expired approvals', () => {
  function setup() {
    let clock = new Date('2026-11-11T00:00:00Z');
    const store = new MemoryAgentStore(() => clock);
    const sink = new MemoryAuditSink();
    const audit = new AuditLogger(sink);
    const enqueued: string[] = [];
    const loop = createAgentLoop({
      client: {} as never,
      addresses: ADDRS,
      store,
      audit,
      readSnapshot: async () => snapshot(),
      now: () => clock,
    });
    const approval = createApprovalService({ store, audit, executor: { enqueue: async (id) => void enqueued.push(id) }, now: () => clock });
    return { store, sink, loop, approval, enqueued, advance: (s: number) => (clock = new Date(clock.getTime() + s * 1000)) };
  }

  it('approve after TTL → EXPIRED, 409 INVALID_STATE, DECISION_EXPIRED audited once, never executed', async () => {
    const t = setup();
    const d = (await t.loop.tick()).created[0]!;
    t.advance(t.store.settings.decisionTtlSec);
    await expect(t.approval.approve(d.id, '0xAdmin')).rejects.toMatchObject({ code: 'INVALID_STATE', status: 'EXPIRED' });
    await expect(t.approval.approve(d.id, '0xAdmin')).rejects.toMatchObject({ code: 'INVALID_STATE', status: 'EXPIRED' });
    await expect(t.approval.reject(d.id, '0xAdmin')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(t.enqueued).toEqual([]);
    expect(t.sink.entries.filter((e) => e.eventType === 'DECISION_EXPIRED')).toEqual([
      expect.objectContaining({ actor: 'system', entityType: 'DECISION', entityId: d.id }),
    ]);
  });

  it('the tick expires stale decisions and audits DECISION_EXPIRED; reject audits DECISION_REJECTED', async () => {
    const t = setup();
    const d = (await t.loop.tick()).created[0]!;
    t.advance(t.store.settings.decisionTtlSec + 1);
    const r = await t.loop.tick();
    expect(r.expired).toEqual([d.id]);
    expect(t.sink.entries.some((e) => e.eventType === 'DECISION_EXPIRED' && e.entityId === d.id)).toBe(true);

    const fresh = r.created[0]!;
    await t.approval.reject(fresh.id, '0xAdmin', 'not now');
    expect(t.sink.entries.at(-1)).toMatchObject({ eventType: 'DECISION_REJECTED', actor: '0xAdmin', entityId: fresh.id, payload: { reason: 'not now' } });
  });

  it('an APPROVED decision is not expired by the TTL sweep (only PENDING_APPROVAL expires)', async () => {
    const t = setup();
    const d = (await t.loop.tick()).created[0]!;
    await t.approval.approve(d.id, '0xAdmin');
    t.advance(t.store.settings.decisionTtlSec * 10);
    await t.loop.tick();
    expect((await t.store.getDecision(d.id))!.status).toBe('APPROVED');
  });
});
