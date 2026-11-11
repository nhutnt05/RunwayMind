import { describe, expect, it } from 'vitest';
import { loadBackendConfig } from '../src/config';
import { metadataHash } from '../prisma/seed';

const valid = {
  FUJI_RPC_URL: 'https://api.avax-test.network/ext/bc/C/rpc',
  DATABASE_URL: 'file:./runwaymind.db',
  SESSION_SECRET: 'a'.repeat(64),
  APP_ORIGIN: 'http://localhost:3000',
  AGENT_LOOP_INTERVAL_SEC: '30',
};

describe('loadBackendConfig (docs/14 §4)', () => {
  it('applies defaults and strips docs/11 §4 trailing comments', () => {
    const cfg = loadBackendConfig({ ...valid, PORT: '4000   # api', KEEPER_ENABLED: 'false' });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.CHAIN_ID).toBe(43113);
    expect(cfg.KEEPER_ENABLED).toBe(false);
    expect(cfg.AGENT_ENABLED).toBe(true);
  });

  it('names every missing variable', () => {
    expect(() => loadBackendConfig({})).toThrow(/FUJI_RPC_URL[\s\S]*DATABASE_URL[\s\S]*SESSION_SECRET[\s\S]*APP_ORIGIN/);
    expect(() => loadBackendConfig({ ...valid, SESSION_SECRET: '<random_64_hex>' })).toThrow(/SESSION_SECRET/);
  });
});

describe('seed metadataHash (docs/07 §5.1)', () => {
  it('hashes canonical JSON exactly like scripts/SeedDemo.s.sol', () => {
    // keccak256('{"category":"PAYROLL","label":"November payroll","notes":null,"source":"SEED"}')
    expect(metadataHash({ label: 'November payroll', notes: null, category: 'PAYROLL', source: 'SEED' })).toMatch(/^0x[0-9a-f]{64}$/);
    expect(metadataHash({ label: 'a', notes: null, category: 'GRANT', source: 'SEED' })).not.toBe(
      metadataHash({ label: 'a', notes: null, category: 'PAYROLL', source: 'SEED' }),
    );
  });
});
