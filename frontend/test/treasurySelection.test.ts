import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../lib/api';
import { contractsFromTreasury } from '../lib/contracts';
import {
  TREASURY_STORAGE_KEY,
  getSelectedTreasuryId,
  readStoredTreasuryId,
  resolveSelectedTreasury,
  setSelectedTreasuryId,
  subscribeTreasury,
  withTreasuryParam,
  type TreasuryInfo,
} from '../lib/treasurySelection';

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`;
const t = (id: string, isPrimary: boolean, n: number): TreasuryInfo => ({
  id,
  chainId: 43113,
  isPrimary,
  treasuryAddress: A(n),
  registryAddress: A(n + 1),
  policyAddress: A(n + 2),
  assetAddress: A(n + 3),
  assetSymbol: 'mUSDC',
  assetDecimals: 6,
  demoStartTime: 1,
  deployBlock: '1',
  poolAddress: A(n + 4),
  adapterAddress: A(n + 5),
});
const LIST = [t('fuji-musdc', true, 0x10), t('fuji-second', false, 0x20)];

describe('resolveSelectedTreasury', () => {
  it('stored id if listed, else primary, else first; null for empty list', () => {
    expect(resolveSelectedTreasury(LIST, 'fuji-second')?.id).toBe('fuji-second');
    expect(resolveSelectedTreasury(LIST, 'gone')?.id).toBe('fuji-musdc');
    expect(resolveSelectedTreasury(LIST, null)?.id).toBe('fuji-musdc');
    expect(resolveSelectedTreasury([t('b', false, 1), t('c', false, 2)], null)?.id).toBe('b');
    expect(resolveSelectedTreasury([], 'x')).toBeNull();
  });
});

describe('withTreasuryParam', () => {
  it('adds or replaces treasury=<id>, keeps other params, no-op for null', () => {
    expect(withTreasuryParam('/treasury/overview', 'fuji-second')).toBe('/treasury/overview?treasury=fuji-second');
    expect(withTreasuryParam('/obligations?status=ACTIVE', 'fuji-second')).toBe('/obligations?status=ACTIVE&treasury=fuji-second');
    expect(withTreasuryParam('/x?treasury=a&limit=5', 'b')).toBe('/x?treasury=b&limit=5');
    expect(withTreasuryParam('/health', null)).toBe('/health');
  });
});

describe('treasury store', () => {
  it('readStoredTreasuryId tolerates missing / throwing storage', () => {
    expect(readStoredTreasuryId(undefined)).toBeNull();
    expect(readStoredTreasuryId({ getItem: () => 'fuji-second' })).toBe('fuji-second');
    expect(readStoredTreasuryId({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(TREASURY_STORAGE_KEY).toBe('runwaymind.treasury');
  });

  it('set → get → listeners notified; api client appends the selected treasury to every request', async () => {
    const seen: string[] = [];
    const unsub = subscribeTreasury(() => seen.push(String(getSelectedTreasuryId())));
    setSelectedTreasuryId('fuji-second');
    expect(getSelectedTreasuryId()).toBe('fuji-second');
    expect(seen).toEqual(['fuji-second']);

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: [], error: null, meta: { requestId: 'r' } })));
    const client = createApiClient('http://api.test/api/v1', fetchImpl as unknown as typeof fetch);
    await client.get('/obligations?status=ACTIVE');
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('http://api.test/api/v1/obligations?status=ACTIVE&treasury=fuji-second');

    setSelectedTreasuryId(null);
    await client.get('/health');
    expect(String((fetchImpl.mock.calls[1] as unknown[])[0])).toBe('http://api.test/api/v1/health');
    unsub();
  });
});

describe('contractsFromTreasury', () => {
  it('maps the API addresses to the contract bindings used by reads / write verification', () => {
    const c = contractsFromTreasury(LIST[1]!);
    expect([c.treasury.address, c.registry.address, c.policy.address, c.pool.address]).toEqual([A(0x20), A(0x21), A(0x22), A(0x24)]);
    expect(contractsFromTreasury({ ...LIST[1]!, poolAddress: null }).pool.address).toBeUndefined();
  });
});
