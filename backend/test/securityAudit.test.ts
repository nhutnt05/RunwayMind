// D7 pre-release security / reliability audit: one regression test per fixed finding.
import { Writable } from 'node:stream';
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogger, MemoryAuditSink } from '@runwaymind/agent';
import { obligationRegistryAbi } from '@runwaymind/shared/abi';
import { createRepositories } from '../src/repositories';
import { PrismaAgentStore } from '../src/repositories/agentStore';
import { createScheduler, failInterruptedExecutions } from '../src/scheduler';
import { ViemChainService } from '../src/services/chain';
import { DAY, FakeChain, T0, TREASURY_ID, USDC, loginCookie, makeApp, prisma, resetDb } from './helpers';

const API = '/api/v1';
const admin = privateKeyToAccount(generatePrivateKey());
const attacker = privateKeyToAccount(generatePrivateKey());
const SECRET = 'SECRETKEY123';
const RPC_ERROR = `HTTP request failed.\n\nURL: https://avalanche-fuji.example.io/v2/${SECRET}\nRequest body: {"method":"eth_blockNumber"}`;
const RECIPIENT = getAddress('0x00000000000000000000000000000000000000b7');
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;

const createBody = {
  label: 'December payroll',
  notes: 'team of 4',
  category: 'PAYROLL',
  recipient: RECIPIENT,
  amount: '20000000000',
  firstDueDate: T0 + 30 * DAY,
  interval: 0,
  maxOccurrences: 1,
};

function obligationCreatedLog(registry: Address, txHash: Hex, metadataHash: Hex): Log {
  const args = {
    id: 7n,
    recipient: RECIPIENT,
    amount: USDC(20_000),
    firstDueDate: BigInt(createBody.firstDueDate),
    interval: 0n,
    maxOccurrences: 1,
    category: 0,
    metadataHash,
  };
  const ev = (obligationRegistryAbi as unknown as readonly { type: string; name?: string; inputs?: { name: string; type: string; indexed?: boolean }[] }[]).find(
    (i) => i.type === 'event' && i.name === 'ObligationCreated',
  )!;
  const nonIndexed = ev.inputs!.filter((i) => !i.indexed);
  return {
    address: registry,
    topics: encodeEventTopics({ abi: obligationRegistryAbi as Abi, eventName: 'ObligationCreated', args } as never) as [Hex, ...Hex[]],
    data: encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => (args as Record<string, unknown>)[i.name]) as never),
    blockNumber: 201n,
    transactionHash: txHash,
    logIndex: 0,
    blockHash: hashOf(9),
    transactionIndex: 0,
    removed: false,
  } as Log;
}

describe('D7 audit — API hardening', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('CHAIN_UNAVAILABLE never echoes the RPC URL (API key) to the client', async () => {
    const client = { getBlockNumber: async () => Promise.reject(new Error(RPC_ERROR)) } as unknown as PublicClient;
    const chain = new ViemChainService(client, new FakeChain().addresses);
    const { app } = await makeApp(chain as unknown as FakeChain);
    const res = await app.inject({ method: 'GET', url: `${API}/health` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('CHAIN_UNAVAILABLE');
    expect(res.body).not.toContain(SECRET);
    expect(res.json().error.details.cause).toContain('https://avalanche-fuji.example.io/…');
  });

  it('unhandled 500 errors are logged without the RPC URL', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write: (chunk, _enc, cb) => (lines.push(String(chunk)), cb()) });
    const chain = new FakeChain();
    chain.admins.add(admin.address);
    const { app } = await makeApp(chain, undefined, {
      logger: { level: 'error', stream } as never,
      scheduler: (c) =>
        createScheduler({
          loop: { tick: async () => Promise.reject(new Error(RPC_ERROR)) },
          executor: null,
          keeper: null,
          indexer: null,
          getSettings: () => c.repos.agentSettings(),
        }),
    });
    const cookie = await loginCookie(app, admin);
    const res = await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    const logged = lines.join('');
    expect(logged).toContain('unhandled error');
    expect(logged).not.toContain(SECRET);
  });

  it('GET /keeper/status lastError (public) does not leak the RPC URL of a failed keeper run', async () => {
    const scheduler = createScheduler({
      loop: null,
      executor: null,
      keeper: { tick: async () => Promise.reject(new Error(RPC_ERROR)), address: admin.address },
      indexer: null,
      getSettings: async () => {
        throw new Error('unused');
      },
    });
    await expect(scheduler.runKeeper()).rejects.toThrow();
    const status = await scheduler.keeperStatus();
    expect(status.lastError).toContain('HTTP request failed');
    expect(status.lastError).not.toContain(SECRET);
  });

  it('?treasury= given twice → 400 VALIDATION_ERROR (never a silent fallback to the primary treasury)', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: `${API}/inflows?treasury=${TREASURY_ID}&treasury=other` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect((await app.inject({ method: 'GET', url: `${API}/inflows?treasury=${TREASURY_ID}` })).statusCode).toBe(200);
  });

  it('POST /transactions cannot relabel an obligation by pairing its creation tx with an unrelated draft', async () => {
    const chain = new FakeChain();
    chain.admins.add(admin.address);
    const { app } = await makeApp(chain);
    const adminCookie = await loginCookie(app, admin);
    const attackerCookie = await loginCookie(app, attacker); // any SIWE wallet, no role
    const post = (payload: object) => app.inject({ method: 'POST', url: `${API}/obligations`, headers: { cookie: adminCookie }, payload });
    const real = (await post(createBody)).json().data;
    const other = (await post({ ...createBody, label: 'Pay the attacker', notes: null })).json().data;

    const txHash = hashOf(0xc1);
    chain.receipts.set(txHash, { status: 'success', blockNumber: 201n, from: admin.address, logs: [obligationCreatedLog(chain.addresses.registry, txHash, real.metadataHash)] });

    // Attacker registers the real creation tx first, with the other draft's id (draft ids are public via /audit-logs).
    const hijack = await app.inject({
      method: 'POST',
      url: `${API}/transactions`,
      headers: { cookie: attackerCookie },
      payload: { txHash, kind: 'CREATE_OBLIGATION', relatedDraftId: other.draftId },
    });
    expect(hijack.statusCode).toBe(200);
    await vi.waitFor(async () => expect((await prisma.transaction.findUnique({ where: { hash: txHash } }))?.status).toBe('CONFIRMED'));
    expect(await prisma.obligationMetadata.findFirst({ where: { obligationId: '7' } })).toBeNull();
    expect((await prisma.obligationDraft.findUnique({ where: { id: other.draftId } }))?.status).toBe('SUBMITTED');

    // The matching draft still links.
    await app.inject({ method: 'POST', url: `${API}/transactions`, headers: { cookie: adminCookie }, payload: { txHash, kind: 'CREATE_OBLIGATION', relatedDraftId: real.draftId } });
    await vi.waitFor(async () =>
      expect(await prisma.obligationMetadata.findFirst({ where: { obligationId: '7' } })).toMatchObject({ label: 'December payroll', metadataHash: real.metadataHash }),
    );
  });
});

describe('D7 audit — scheduler lifecycle', () => {
  beforeEach(resetDb);
  afterEach(() => vi.useRealTimers());
  afterAll(() => prisma.$disconnect());

  async function decision(store: PrismaAgentStore, status: 'EXECUTING' | 'APPROVED') {
    return store.createDecision({
      snapshotId: 'snap',
      action: 'TRIP_CIRCUIT_BREAKER',
      adapter: null,
      amount: null,
      reasonCode: 'MANUAL',
      status,
      mode: 'APPROVE',
      facts: {} as never,
      explanation: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
  }

  it('EXECUTING decisions left by a previous process → FAILED (INTERRUPTED) on start, so the slot is not blocked forever', async () => {
    const repos = createRepositories(prisma, TREASURY_ID);
    const store = new PrismaAgentStore(prisma, repos);
    const sink = new MemoryAuditSink();
    const audit = new AuditLogger(sink);
    const stale = await decision(store, 'EXECUTING');
    await new Promise((r) => setTimeout(r, 5));

    let recovered: string[] = [];
    const scheduler = createScheduler({
      loop: null,
      executor: null,
      keeper: null,
      indexer: null,
      getSettings: () => repos.agentSettings(),
      recoverInterrupted: async (before) => (recovered = await failInterruptedExecutions(store, audit, before)),
    });
    await new Promise((r) => setTimeout(r, 5));
    const live = await decision(store, 'EXECUTING'); // started by THIS process's executor: must not be touched
    await scheduler.start();
    scheduler.stop();

    expect(recovered).toEqual([stale.id]);
    expect((await store.getDecision(stale.id))!.status).toBe('FAILED');
    expect((await store.getDecision(live.id))!.status).toBe('EXECUTING');
    expect(sink.entries).toEqual([expect.objectContaining({ eventType: 'ACTION_FAILED', entityId: stale.id, payload: { reason: 'INTERRUPTED', stage: 'EXECUTOR' } })]);
  });

  it('stop() while the next delay is being read never arms a timer (no tick after shutdown)', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tick = vi.fn(async () => ({}) as never);
    const scheduler = createScheduler({
      loop: { tick },
      executor: null,
      keeper: null,
      indexer: null,
      getSettings: async () => {
        await gate;
        return { loopIntervalSec: 10 } as never;
      },
    });
    await scheduler.start();
    scheduler.stop();
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
