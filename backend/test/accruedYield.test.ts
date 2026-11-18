import { describe, expect, it } from 'vitest';
import { ACCRUED_YIELD_MAX_LAG_BLOCKS, accruedYieldView } from '../src/services/treasury';

const U = (n: number) => BigInt(n) * 1_000_000n;

describe('accruedYieldView (vault − net principal, only when the indexer has caught up)', () => {
  it('in sync: yield = vault − principal', () => {
    expect(accruedYieldView({ indexed: true, principal: U(20_000), lastBlock: 1_000n }, 1_010n, U(20_281))).toEqual({
      accruedYield: U(281),
      accruedYieldStatus: 'OK',
      indexerLagBlocks: 10,
    });
  });

  it('indexer behind (missed a recent withdrawal): no number, status SYNCING, never a bogus negative', () => {
    // Fuji case: principal still 20,000 after a withdraw-all the indexer has not seen; vault is ~0.
    const r = accruedYieldView({ indexed: true, principal: U(20_000), lastBlock: 61_239_847n }, 61_270_043n, 205n);
    expect(r).toEqual({ accruedYield: null, accruedYieldStatus: 'SYNCING', indexerLagBlocks: 30_196 });
    expect(accruedYieldView({ indexed: true, principal: 0n, lastBlock: 100n }, 100n + ACCRUED_YIELD_MAX_LAG_BLOCKS, 0n).accruedYieldStatus).toBe('OK');
    expect(accruedYieldView({ indexed: true, principal: 0n, lastBlock: 100n }, 101n + ACCRUED_YIELD_MAX_LAG_BLOCKS, 0n).accruedYieldStatus).toBe('SYNCING');
  });

  it('never indexed: NOT_INDEXED', () => {
    expect(accruedYieldView({ indexed: false, principal: 0n, lastBlock: null }, 5n, 0n)).toEqual({ accruedYield: null, accruedYieldStatus: 'NOT_INDEXED', indexerLagBlocks: null });
  });
});
