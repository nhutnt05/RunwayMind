import { describe, expect, it, vi } from 'vitest';
import { AuthVerifyRequestSchema } from '@runwaymind/shared';
import { ApiError, createApiClient, parseEnvelope } from '../lib/api';
import { countdown, dayIndex, dayLabel, efficiencyLabel, timelinePosition } from '../lib/dashboard';

const T0 = 1_793_318_400;
const DAY = 86_400;

describe('dashboard display helpers', () => {
  it('dayIndex / dayLabel follow docs/04 §4.1', () => {
    expect(dayIndex(T0 + 16 * DAY, T0)).toBe(16);
    expect(dayIndex(T0 + 16 * DAY - 1, T0)).toBe(15);
    expect(dayLabel(T0 + 31 * DAY, T0)).toBe('Day 31');
    expect(dayIndex(T0, null)).toBeNull();
    expect(dayLabel(T0, null)).toBe('2026-10-30');
  });

  it('countdown in whole days from chain time', () => {
    expect(countdown(T0 + 5 * DAY, T0)).toBe('in 5 days');
    expect(countdown(T0 + DAY, T0)).toBe('in 1 day');
    expect(countdown(T0 + 100, T0)).toBe('today');
    expect(countdown(T0 - 100, T0)).toBe('due');
    expect(countdown(T0 - 3 * DAY, T0)).toBe('3 days ago');
  });

  it('efficiencyLabel renders "70% invested (target 70%)" (docs/08 §2)', () => {
    expect(efficiencyLabel(7000, 7000)).toBe('70% invested (target 70%)');
    expect(efficiencyLabel(0, 7000)).toBe('0% invested (target 70%)');
    expect(efficiencyLabel(6999, 7000)).toBe('69.99% invested (target 70%)');
  });

  it('timelinePosition clamps to [0, 100]', () => {
    expect(timelinePosition(T0 + 16 * DAY, T0, T0 + 32 * DAY)).toBe(50);
    expect(timelinePosition(T0 - 1, T0, T0 + DAY)).toBe(0);
    expect(timelinePosition(T0 + 2 * DAY, T0, T0 + DAY)).toBe(100);
    expect(timelinePosition(T0, T0, T0)).toBe(0);
  });
});

describe('api client (docs/07 §2.1 envelope)', () => {
  const ok = { success: true, data: { idle: '100000000000' }, error: null, meta: { requestId: 'r1', chainTime: T0 } };
  const fail = { success: false, data: null, error: { code: 'FORBIDDEN_NOT_ADMIN', message: 'Requires ADMIN role' }, meta: { requestId: 'r2' } };

  it('returns data and meta on success', () => {
    expect(parseEnvelope(200, ok)).toEqual({ data: { idle: '100000000000' }, meta: { requestId: 'r1', chainTime: T0 } });
  });

  it('throws ApiError with the envelope code on failure', () => {
    expect(() => parseEnvelope(403, fail)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN_NOT_ADMIN', status: 403 }));
    expect(() => parseEnvelope(502, '<html>')).toThrow(ApiError);
  });

  it('sends credentials and maps network failures to NETWORK_ERROR', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(ok), { status: 200 }));
    const client = createApiClient('http://api.test/api/v1/', fetchMock as unknown as typeof fetch);
    await client.get('/treasury/overview');
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/v1/treasury/overview', expect.objectContaining({ credentials: 'include', method: 'GET' }));

    const broken = createApiClient('http://api.test', (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
    await expect(broken.get('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('validates request bodies with shared zod schemas before sending', async () => {
    const fetchMock = vi.fn();
    const client = createApiClient('http://api.test', fetchMock as unknown as typeof fetch);
    expect(() => client.postValidated('/auth/verify', AuthVerifyRequestSchema, { message: '', signature: 'nothex' })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
