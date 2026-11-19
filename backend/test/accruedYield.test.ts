import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCRUED_YIELD_MAX_LAG_BLOCKS, accruedYieldView } from '../src/services/treasury';
import { FakeChain, makeApp, prisma, resetDb, TREASURY_ID } from './helpers';

const U = (n: number) => BigInt(n) * 1_000_000n;

describe('accruedYieldView (vault − net principal)', () => {
  it('in sync: OK, yield = vault − principal − recent app txs', () => {
    expect(accruedYieldView({ indexed: true, principal: U(20_000), lastBlock: 1_000n }, 1_010n, U(20_281))).toEqual({ accruedYield: U(281), accruedYieldStatus: 'OK', indexerLagBlocks: 10 });
  });

  it('indexer far behind but the app tx gap is known: LIVE value (the Fuji case: withdraw-all not yet indexed)', () => {
    // indexed principal 20,000; the app's own Withdrawn(received 20,281.49) after the cursor → gap −20,281.49; vault ~0.
    const r = accruedYieldView({ indexed: true, principal: U(20_000), lastBlock: 61_239_847n }, 61_270_043n, 205n, -20_281_487_946n);
    expect(r.accruedYieldStatus).toBe('LIVE');
    expect(r.accruedYield).toBe(205n + 20_281_487_946n - U(20_000)); // ≈ +281.49 earned, not −20,000
    expect(r.indexerLagBlocks).toBe(30_196);
  });

  it('indexer behind and the gap could not be computed: SYNCING, no number', () => {
    expect(accruedYieldView({ indexed: true, principal: 0n, lastBlock: 100n }, 101n + ACCRUED_YIELD_MAX_LAG_BLOCKS, 0n, null)).toEqual({ accruedYield: null, accruedYieldStatus: 'SYNCING', indexerLagBlocks: 51 });
    expect(accruedYieldView({ indexed: true, principal: 0n, lastBlock: 100n }, 100n + ACCRUED_YIELD_MAX_LAG_BLOCKS, 0n, null).accruedYieldStatus).toBe('OK');
  });

  it('never indexed: NOT_INDEXED', () => {
    expect(accruedYieldView({ indexed: false, principal: 0n, lastBlock: null }, 5n, 0n)).toEqual({ accruedYield: null, accruedYieldStatus: 'NOT_INDEXED', indexerLagBlocks: null });
  });
});

describe('GET /treasury/overview: accrued yield stays live while the indexer catches up', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('counts confirmed app transactions mined after the cursor', async () => {
    const chain = new FakeChain(); // snapshot block 123, adapter balance from srcSnapshot
    const vault = chain.snapshot.adapters[0]!.balance;
    // Indexed up to block 10: invested 70,000.
    await prisma.chainEventCursor.create({ data: { treasuryId: TREASURY_ID, lastBlock: '10' } });
    await prisma.indexedEvent.create({ data: { id: 'a:0', treasuryId: TREASURY_ID, name: 'Invested', blockNumber: '5', txHash: '0xa', args: JSON.stringify({ amount: U(70_000).toString() }) } });
    // App tx after the cursor (block 120): invested another 5,000 → principal 75,000.
    await prisma.transaction.create({
      data: { hash: '0xb', treasuryId: TREASURY_ID, kind: 'INVEST', fromAddress: '0x0000000000000000000000000000000000000001', initiator: 'AGENT', status: 'CONFIRMED', blockNumber: '120', decodedEvents: JSON.stringify([{ name: 'Invested', args: { amount: U(5_000).toString() } }]) },
    });
    const { app } = await makeApp(chain);
    const d = (await app.inject({ method: 'GET', url: '/api/v1/treasury/overview' })).json().data;
    expect(d.accruedYieldStatus).toBe('LIVE'); // 113 blocks behind > 50
    expect(BigInt(d.accruedYield)).toBe(vault - U(75_000));
  });
});
