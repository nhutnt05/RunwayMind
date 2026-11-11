import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { requireAdmin } from '../src/auth/guards';
import { ok } from '../src/plugins/envelope';
import { FakeChain, makeApp, prisma, resetDb } from './helpers';

const admin = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());

async function login(app: Awaited<ReturnType<typeof makeApp>>['app'], account = admin, overrides: Record<string, unknown> = {}) {
  const nonceRes = await app.inject({ method: 'POST', url: '/api/v1/auth/nonce' });
  const nonce = nonceRes.json().data.nonce as string;
  const message = createSiweMessage({
    address: account.address,
    chainId: 43113,
    domain: 'localhost:3000',
    nonce,
    uri: 'http://localhost:3000',
    version: '1',
    ...overrides,
  });
  const signature = await account.signMessage({ message });
  return app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { message, signature } });
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  return first.split(';')[0]!;
}

describe('SIWE auth (docs/07 §3.1)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('nonce → verify → me → logout', async () => {
    const chain = new FakeChain();
    chain.admins.add(admin.address);
    const { app } = await makeApp(chain);
    const res = await login(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ address: admin.address, isAdmin: true, isAgent: false });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^rm_session=/);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ address: admin.address, isAdmin: true, isAgent: false, expiresAt: expect.any(Number) });

    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers['set-cookie'])).toMatch(/rm_session=;/);
    expect(await prisma.auditLog.count({ where: { eventType: 'LOGIN' } })).toBe(1);
  });

  it('GET /auth/me without session → 401 UNAUTHENTICATED', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects wrong chain id, wrong domain, reused nonce, bad signature', async () => {
    const { app } = await makeApp();
    expect((await login(app, admin, { chainId: 1 })).statusCode).toBe(401);
    expect((await login(app, admin, { domain: 'evil.example' })).statusCode).toBe(401);

    const nonce = (await app.inject({ method: 'POST', url: '/api/v1/auth/nonce' })).json().data.nonce;
    const message = createSiweMessage({ address: admin.address, chainId: 43113, domain: 'localhost:3000', nonce, uri: 'http://localhost:3000', version: '1' });
    const signature = await admin.signMessage({ message });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { message, signature } })).statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { message, signature } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.message).toMatch(/nonce/i);

    const nonce2 = (await app.inject({ method: 'POST', url: '/api/v1/auth/nonce' })).json().data.nonce;
    const msg2 = createSiweMessage({ address: admin.address, chainId: 43113, domain: 'localhost:3000', nonce: nonce2, uri: 'http://localhost:3000', version: '1' });
    const forged = await viewer.signMessage({ message: msg2 });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { message: msg2, signature: forged } })).statusCode).toBe(401);
  });

  it('rejects an expired nonce', async () => {
    let t = new Date('2026-11-10T00:00:00Z');
    const { app } = await makeApp(new FakeChain(), () => t);
    const nonce = (await app.inject({ method: 'POST', url: '/api/v1/auth/nonce' })).json().data.nonce;
    t = new Date(t.getTime() + 6 * 60_000); // > 5 min
    const message = createSiweMessage({ address: admin.address, chainId: 43113, domain: 'localhost:3000', nonce, uri: 'http://localhost:3000', version: '1', issuedAt: t });
    const signature = await admin.signMessage({ message });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { message, signature } });
    expect(res.statusCode).toBe(401);
  });

  it('POST /auth/verify — 400 VALIDATION_ERROR for a missing signature', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { message: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('admin guard: 401 without session, 403 FORBIDDEN_NOT_ADMIN for non-admin, 200 for admin; role cached 60 s', async () => {
    const chain = new FakeChain();
    chain.admins.add(admin.address);
    const { app, auth } = await makeApp(chain);
    app.get('/api/v1/__admin-probe', { preHandler: requireAdmin(auth) }, async (req) => ok(req, { ok: true }));

    expect((await app.inject({ method: 'GET', url: '/api/v1/__admin-probe' })).statusCode).toBe(401);

    const viewerCookie = cookieOf(await login(app, viewer));
    const forbidden = await app.inject({ method: 'GET', url: '/api/v1/__admin-probe', headers: { cookie: viewerCookie } });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN_NOT_ADMIN');

    const adminCookie = cookieOf(await login(app, admin));
    const calls = chain.roleCalls;
    const allowed = await app.inject({ method: 'GET', url: '/api/v1/__admin-probe', headers: { cookie: adminCookie } });
    expect(allowed.statusCode).toBe(200);
    expect(chain.roleCalls).toBe(calls); // served from the 60 s role cache
  });
});
