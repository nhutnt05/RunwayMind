// docs/07 §5.1–§5.3 obligation writes (prepared ADMIN tx + simulation), §4.8 transactions/audit, §6 event indexer.
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { obligationRegistryAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { obligationMetadataHash } from '@runwaymind/shared';
import { createIndexer, pulledIntoTreasury } from '../src/indexer';
import { createRepositories } from '../src/repositories';
import { ADAPTER, DAY, FakeChain, T0, TREASURY, TREASURY_ID, USDC, loginCookie, makeApp, prisma, resetDb } from './helpers';

const admin = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());
const API = '/api/v1';
const ASSET: Address = '0x00000000000000000000000000000000000000F2';
const RECIPIENT = getAddress('0x00000000000000000000000000000000000000b7');
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;

/** Encodes one event as a raw log (indexed args → topics, the rest → data). */
function eventLog(abi: Abi, eventName: string, args: Record<string, unknown>, o: { address: Address; txHash: Hex; logIndex: number; block?: bigint }): Log {
  const ev = (abi as readonly { type: string; name?: string; inputs?: { name: string; type: string; indexed?: boolean }[] }[]).find(
    (i) => i.type === 'event' && i.name === eventName,
  )!;
  args = Object.fromEntries(
    Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v.toLowerCase()) : v]),
  );
  const topics = encodeEventTopics({ abi, eventName, args } as never);
  const nonIndexed = ev.inputs!.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never);
  return {
    address: o.address,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: o.block ?? 200n,
    transactionHash: o.txHash,
    logIndex: o.logIndex,
    blockHash: hashOf(9),
    transactionIndex: 0,
    removed: false,
  } as Log;
}

async function setup() {
  const chain = new FakeChain();
  chain.admins.add(admin.address);
  const built = await makeApp(chain);
  return { ...built, chain, adminCookie: await loginCookie(built.app, admin), viewerCookie: await loginCookie(built.app, viewer) };
}

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

describe('obligation writes (docs/07 §5.1–§5.3)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('POST /obligations → draft + metadataHash + prepared createObligation simulated from the caller', async () => {
    const { app, chain, adminCookie } = await setup();
    const res = await app.inject({ method: 'POST', url: `${API}/obligations`, headers: { cookie: adminCookie }, payload: createBody });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    const expectedHash = obligationMetadataHash({ label: 'December payroll', notes: 'team of 4', category: 'PAYROLL', source: 'FORM' });
    expect(data).toMatchObject({
      draftId: expect.stringMatching(/^drf_/),
      metadataHash: expectedHash,
      preparedTx: { to: chain.addresses.registry, value: '0', chainId: 43113, functionName: 'createObligation' },
      simulation: { ok: true, error: null },
    });
    const decoded = decodeFunctionData({ abi: obligationRegistryAbi as Abi, data: data.preparedTx.data });
    expect(decoded.functionName).toBe('createObligation');
    expect(decoded.args?.[0]).toMatchObject({
      recipient: RECIPIENT,
      amount: USDC(20_000),
      firstDueDate: BigInt(T0 + 30 * DAY),
      interval: 0n,
      maxOccurrences: 1,
      category: 0,
      metadataHash: expectedHash,
    });
    expect(chain.simulations[0]?.account).toBe(admin.address);
    const draft = await prisma.obligationDraft.findUnique({ where: { id: data.draftId } });
    expect(draft).toMatchObject({ status: 'SUBMITTED', label: 'December payroll', notes: 'team of 4', amount: '20000000000' });
  });

  it('POST /obligations validation: due date ≤ chain time, recipient = Treasury, bad amount → 400; non-admin → 403', async () => {
    const { app, adminCookie, viewerCookie } = await setup();
    const post = (payload: object, cookie = adminCookie) => app.inject({ method: 'POST', url: `${API}/obligations`, headers: { cookie }, payload });
    const past = await post({ ...createBody, firstDueDate: T0 });
    expect(past.statusCode).toBe(400);
    expect(past.json().error.details[0].path).toBe('firstDueDate');
    expect((await post({ ...createBody, recipient: TREASURY })).statusCode).toBe(400);
    expect((await post({ ...createBody, amount: '1.5' })).statusCode).toBe(400);
    expect((await post({ ...createBody, interval: 0, maxOccurrences: 0 })).statusCode).toBe(400);
    const forbidden = await post(createBody, viewerCookie);
    expect(forbidden.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${API}/obligations`, payload: createBody })).statusCode).toBe(401);
  });

  it('simulation revert is returned decoded (simulation.ok = false), tx still prepared', async () => {
    const { app, chain, adminCookie } = await setup();
    chain.simulation = { ok: false, error: { name: 'TooManyActiveObligations', args: {} }, message: 'reverted' };
    const res = await app.inject({ method: 'POST', url: `${API}/obligations`, headers: { cookie: adminCookie }, payload: createBody });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.simulation).toEqual({ ok: false, error: { name: 'TooManyActiveObligations', args: {} } });
  });

  it('PATCH /obligations/:id: label-only → DB, no tx; amount → prepared updateObligation keeping other fields', async () => {
    const { app, adminCookie } = await setup();
    const labelOnly = await app.inject({
      method: 'PATCH',
      url: `${API}/obligations/1`,
      headers: { cookie: adminCookie },
      payload: { label: 'Nov payroll (core)' },
    });
    expect(labelOnly.statusCode).toBe(200);
    expect(labelOnly.json().data).toEqual({ draftId: null, metadataHash: null, preparedTx: null, simulation: null });
    expect((await prisma.obligationMetadata.findFirst({ where: { obligationId: '1' } }))?.label).toBe('Nov payroll (core)');

    const amount = await app.inject({ method: 'PATCH', url: `${API}/obligations/1`, headers: { cookie: adminCookie }, payload: { amount: '25000000000' } });
    expect(amount.statusCode).toBe(200);
    const tx = amount.json().data.preparedTx;
    expect(tx.functionName).toBe('updateObligation');
    const decoded = decodeFunctionData({ abi: obligationRegistryAbi as Abi, data: tx.data });
    expect(decoded.args).toEqual([1n, getAddress(`0x${'1'.padStart(40, '0')}`), USDC(25_000), BigInt(T0 + 7 * DAY)]);

    expect((await app.inject({ method: 'PATCH', url: `${API}/obligations/1`, headers: { cookie: adminCookie }, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `${API}/obligations/99`, headers: { cookie: adminCookie }, payload: { amount: '1' } })).statusCode).toBe(404);
  });

  it('POST /obligations/:id/cancel → prepared cancelObligation; cancelled obligation → 409', async () => {
    const { app, adminCookie } = await setup();
    const res = await app.inject({ method: 'POST', url: `${API}/obligations/2/cancel`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    const decoded = decodeFunctionData({ abi: obligationRegistryAbi as Abi, data: res.json().data.preparedTx.data });
    expect(decoded).toMatchObject({ functionName: 'cancelObligation', args: [2n] });
    const cancelled = await app.inject({ method: 'POST', url: `${API}/obligations/4/cancel`, headers: { cookie: adminCookie } });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error.code).toBe('INVALID_STATE');
  });
});

describe('transactions + audit (docs/07 §4.8)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('POST /transactions registers PENDING, settles from the receipt and links ObligationMetadata via the draft', async () => {
    const { app, chain, adminCookie } = await setup();
    const prep = (await app.inject({ method: 'POST', url: `${API}/obligations`, headers: { cookie: adminCookie }, payload: createBody })).json().data;
    const txHash = hashOf(0xc1);
    chain.receipts.set(txHash, {
      status: 'success',
      blockNumber: 201n,
      from: admin.address,
      logs: [
        eventLog(
          obligationRegistryAbi as Abi,
          'ObligationCreated',
          {
            id: 7n,
            recipient: RECIPIENT,
            amount: USDC(20_000),
            firstDueDate: BigInt(createBody.firstDueDate),
            interval: 0n,
            maxOccurrences: 1,
            category: 0,
            metadataHash: prep.metadataHash,
          },
          { address: chain.addresses.registry, txHash, logIndex: 0 },
        ),
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: `${API}/transactions`,
      headers: { cookie: adminCookie },
      payload: { txHash, kind: 'CREATE_OBLIGATION', relatedDraftId: prep.draftId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ hash: txHash, kind: 'CREATE_OBLIGATION', snowtraceUrl: `https://testnet.snowtrace.io/tx/${txHash}` });

    await vi.waitFor(async () => {
      const t = (await app.inject({ method: 'GET', url: `${API}/transactions/${txHash}` })).json().data;
      expect(t).toMatchObject({ status: 'CONFIRMED', blockNumber: '201', decodedEvents: [{ name: 'ObligationCreated', args: { id: '7' } }] });
    });
    const meta = await prisma.obligationMetadata.findFirst({ where: { obligationId: '7' } });
    expect(meta).toMatchObject({ label: 'December payroll', notes: 'team of 4', source: 'FORM', metadataHash: prep.metadataHash, createTxHash: txHash });
    expect((await prisma.obligationDraft.findUnique({ where: { id: prep.draftId } }))?.status).toBe('CONFIRMED');

    const list = await app.inject({ method: 'GET', url: `${API}/transactions?kind=CREATE_OBLIGATION&limit=10` });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().meta.nextCursor).toBeNull();
  });

  it('POST /transactions requires a session; invalid hash → 400; unknown hash → 404', async () => {
    const { app, viewerCookie } = await setup();
    const payload = { txHash: hashOf(1), kind: 'OTHER' };
    expect((await app.inject({ method: 'POST', url: `${API}/transactions`, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `${API}/transactions`, headers: { cookie: viewerCookie }, payload: { ...payload, txHash: '0x12' } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `${API}/transactions`, headers: { cookie: viewerCookie }, payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe('PENDING'); // no receipt yet (indexer picks it up later)
    expect((await app.inject({ method: 'GET', url: `${API}/transactions/${hashOf(2)}` })).statusCode).toBe(404);
  });

  it('GET /transactions paginates with an opaque cursor; GET /audit-logs filters by entity', async () => {
    const { app } = await setup();
    const repos = createRepositories(prisma, TREASURY_ID);
    for (let i = 1; i <= 3; i++) {
      await repos.upsertTransaction({ hash: hashOf(i), kind: 'PAY', from: TREASURY, initiator: 'KEEPER', status: 'CONFIRMED', blockNumber: BigInt(i), decodedEvents: null, error: null, relatedId: null });
    }
    const p1 = (await app.inject({ method: 'GET', url: `${API}/transactions?limit=2` })).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.meta.nextCursor).toEqual(expect.any(String));
    const p2 = (await app.inject({ method: 'GET', url: `${API}/transactions?limit=2&cursor=${p1.meta.nextCursor}` })).json();
    expect(p2.data).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `${API}/transactions?limit=500` })).statusCode).toBe(400);

    await repos.audit('DECISION_CREATED', 'system', { amount: 5n }, { type: 'DECISION', id: 'dec_1' });
    await repos.audit('DECISION_CREATED', 'system', {}, { type: 'DECISION', id: 'dec_2' });
    const logs = (await app.inject({ method: 'GET', url: `${API}/audit-logs?entityType=DECISION&entityId=dec_1` })).json().data;
    expect(logs).toEqual([expect.objectContaining({ eventType: 'DECISION_CREATED', entityId: 'dec_1', payload: { amount: '5' } })]);
  });
});

describe('event indexer (docs/07 §6)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  const AGENT: Address = '0x00000000000000000000000000000000000000A9';
  const REGISTRY: Address = '0x00000000000000000000000000000000000000F3';
  const POOL: Address = '0x00000000000000000000000000000000000000C1';

  function fakeClient(logs: Log[], receipts: Record<string, { from: Address; logs: Log[] }>, head = 300n) {
    return {
      getBlockNumber: vi.fn(async () => head),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        logs.filter((l) => l.blockNumber! >= fromBlock && l.blockNumber! <= toBlock),
      ),
      getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => ({ status: 'success', blockNumber: 200n, ...receipts[hash]! })),
      readContract: vi.fn(async () => BigInt(T0 + DAY)),
    } as unknown as PublicClient & { getLogs: ReturnType<typeof vi.fn> };
  }

  it('indexes Invested / ObligationPaid (with pulled liquidity) and drives accruedYield; idempotent', async () => {
    const investTx = hashOf(0xa1);
    const payTx = hashOf(0xa2);
    const invested = eventLog(treasuryAbi as Abi, 'Invested', { adapter: ADAPTER, amount: USDC(70_000), caller: AGENT, idleAfter: USDC(30_000) }, { address: TREASURY, txHash: investTx, logIndex: 0, block: 150n });
    const paid = eventLog(treasuryAbi as Abi, 'ObligationPaid', { id: 1n, recipient: RECIPIENT, amount: USDC(20_000), occurrence: 1, caller: AGENT }, { address: TREASURY, txHash: payTx, logIndex: 2, block: 250n });
    const pullTransfer = eventLog(erc20Abi as Abi, 'Transfer', { from: ADAPTER, to: TREASURY, value: USDC(5_000) }, { address: ASSET, txHash: payTx, logIndex: 0, block: 250n });
    const payTransfer = eventLog(erc20Abi as Abi, 'Transfer', { from: TREASURY, to: RECIPIENT, value: USDC(20_000) }, { address: ASSET, txHash: payTx, logIndex: 1, block: 250n });
    const client = fakeClient([invested, paid], {
      [investTx]: { from: AGENT, logs: [invested] },
      [payTx]: { from: POOL, logs: [pullTransfer, payTransfer, paid] },
    });
    const repos = createRepositories(prisma, TREASURY_ID);
    const indexer = createIndexer({ client, addresses: { treasury: TREASURY, registry: REGISTRY }, asset: ASSET, repos, startBlock: 100n, chunkSize: 100n });

    const r = await indexer.poll();
    expect(r).toEqual({ fromBlock: 100n, toBlock: 300n, events: 2 });
    expect(client.getLogs).toHaveBeenCalledTimes(3); // 100–199, 200–299, 300–300
    expect(await repos.eventCursor()).toBe(300n);

    const ev = await prisma.indexedEvent.findMany({ orderBy: { blockNumber: 'asc' } });
    expect(ev.map((e) => e.name)).toEqual(['Invested', 'ObligationPaid']);
    expect(JSON.parse(ev[1]!.args)).toMatchObject({ id: '1', pulled: '5000000000' });
    expect(ev[1]!.chainTime).toBe(T0 + DAY);
    expect(await prisma.transaction.findUnique({ where: { hash: payTx } })).toMatchObject({ kind: 'PAY', initiator: 'INDEXER', status: 'CONFIRMED' });

    // principal = 70,000 − 5,000 pulled; adapter now holds 65,100 → accruedYield 100
    expect(await repos.netPrincipal()).toEqual({ indexed: true, principal: USDC(65_000) });
    const chain = new FakeChain();
    chain.snapshot = { ...chain.snapshot, adapters: [{ ...chain.snapshot.adapters[0]!, balance: USDC(65_100) }] };
    const { app } = await makeApp(chain);
    expect((await app.inject({ method: 'GET', url: `${API}/treasury/overview` })).json().data.accruedYield).toBe('100000000');

    expect(await indexer.poll()).toBeNull(); // nothing new
    expect(await prisma.indexedEvent.count()).toBe(2);
  });

  it('pulledIntoTreasury subtracts amounts already reported by Withdrawn in the same tx', () => {
    const tx = hashOf(0xb1);
    const transfer = eventLog(erc20Abi as Abi, 'Transfer', { from: ADAPTER, to: TREASURY, value: USDC(8_000) }, { address: ASSET, txHash: tx, logIndex: 0 });
    const withdrawn = { name: 'Withdrawn', args: { received: USDC(3_000).toString() } } as never;
    expect(pulledIntoTreasury([transfer], ASSET, TREASURY, [withdrawn])).toBe(USDC(5_000));
    expect(pulledIntoTreasury([transfer], ASSET, TREASURY, [])).toBe(USDC(8_000));
  });
});
