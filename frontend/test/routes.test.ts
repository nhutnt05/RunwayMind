import { describe, expect, it } from 'vitest';
import { shortAddress, snowtraceUrl } from '../lib/format';
import { APP_ROUTES, isActiveRoute } from '../lib/routes';

describe('APP_ROUTES (docs/08 §1)', () => {
  it('has exactly the 10 documented routes in order', () => {
    expect(APP_ROUTES.map((r) => r.href)).toEqual([
      '/',
      '/treasury',
      '/obligations',
      '/cash-ladder',
      '/vault',
      '/pools',
      '/stress-test',
      '/agent',
      '/transactions',
      '/settings',
    ]);
  });

  it('matches the dashboard only on exact "/"', () => {
    expect(isActiveRoute('/', '/')).toBe(true);
    expect(isActiveRoute('/vault', '/')).toBe(false);
    expect(isActiveRoute('/vault', '/vault')).toBe(true);
    expect(isActiveRoute('/vault/0xabc', '/vault')).toBe(true);
    expect(isActiveRoute('/vaults', '/vault')).toBe(false);
  });
});

describe('format helpers', () => {
  it('shortens addresses', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });

  it('builds Snowtrace urls', () => {
    expect(snowtraceUrl('tx', '0xabc', 'https://testnet.snowtrace.io/')).toBe('https://testnet.snowtrace.io/tx/0xabc');
  });
});
