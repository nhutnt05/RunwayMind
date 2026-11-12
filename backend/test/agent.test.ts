// docs/07 §4.7 recommendations / agent / keeper endpoints with the real agent loop (decide engine) over the
// FakeChain SRC snapshot and a fake executor (no RPC). Decision state machine: docs/05 §2.1.
import { randomUUID } from 'node:crypto';
import type { PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentLoop } from '@runwaymind/agent';
import type { SchedulerContext } from '../src/app';
import { createScheduler } from '../src/scheduler';
import { FakeChain, loginCookie, makeApp, prisma, resetDb } from './helpers';

const admin = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());
const API = '/api/v1';

async function setup(opts: { withKeeper?: boolean } = {}) {
  const chain = new FakeChain();
  chain.admins.add(admin.address);
  const enqueued: string[] = [];
  let ctx!: SchedulerContext;
  const keeperTick = vi.fn(async () => ({
    id: 'kr_test',
    chainTime: chain.snapshot.chainTime,
    shortfallBefore: 0n,
    enforced: false,
    paidIds: [1n],
    txHashes: ['0xabc'],
    errors: [],
    startedAt: new Date(),
    finishedAt: new Date(),
  }));
  const built = await makeApp(chain, undefined, {
    scheduler: (c) => {
      ctx = c;
      const executor = {
        address: admin.address,
        enqueue: async (id: string) => {
          enqueued.push(id);
          return c.store.transitionDecision(id, ['APPROVED'], { status: 'EXECUTED' });
        },
      };
      return createScheduler({
        loop: createAgentLoop({
          client: {} as PublicClient,
          addresses: chain.addresses,
          store: c.store,
          audit: c.audit,
          executor,
          readSnapshot: async () => ({ ...chain.snapshot, snapshotId: `snap_${randomUUID()}` }),
        }),
        executor,
        keeper: opts.withKeeper ? { tick: keeperTick, address: viewer.address } : null,
        indexer: null,
        getSettings: () => c.repos.agentSettings(),
        getBalance: async () => 2n * 10n ** 18n,
      });
    },
  });
  const adminCookie = await loginCookie(built.app, admin);
  const viewerCookie = await loginCookie(built.app, viewer);
  return { ...built, chain, enqueued, adminCookie, viewerCookie, ctx: () => ctx, keeperTick };
}

describe('recommendations + agent (docs/07 §4.7)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('POST /agent/evaluate creates INVEST 70,000 PENDING_APPROVAL; approve → APPROVED → executor → EXECUTED', async () => {
    const { app, adminCookie, enqueued } = await setup();
    const evalRes = await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: adminCookie } });
    expect(evalRes.statusCode).toBe(200);
    const decisions = evalRes.json().data.decisions as { id: string; action: string; amount: string; status: string }[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: 'INVEST', amount: '70000000000', status: 'PENDING_APPROVAL', mode: 'APPROVE' });
    const id = decisions[0]!.id;

    const list = await app.inject({ method: 'GET', url: `${API}/recommendations?status=PENDING_APPROVAL` });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0]).toMatchObject({
      id,
      reasonCode: 'IDLE_SURPLUS',
      explanation: { source: 'TEMPLATE', headline: expect.any(String) },
      expiresAt: expect.any(Number),
      actions: [],
    });

    // dedupe: same intent → no new decision on the next tick
    const again = await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: adminCookie } });
    expect(again.json().data.decisions).toHaveLength(0);
    expect(again.json().data.skipped).toEqual([expect.objectContaining({ reason: 'SAME_INTENT_OPEN' })]);

    const approve = await app.inject({ method: 'POST', url: `${API}/recommendations/${id}/approve`, headers: { cookie: adminCookie } });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().data).toMatchObject({ id, approvedBy: admin.address });
    expect(enqueued).toEqual([id]);
    await vi.waitFor(async () => {
      const r = await app.inject({ method: 'GET', url: `${API}/recommendations/${id}` });
      expect(r.json().data.status).toBe('EXECUTED');
    });

    const twice = await app.inject({ method: 'POST', url: `${API}/recommendations/${id}/approve`, headers: { cookie: adminCookie } });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe('INVALID_STATE');

    const audit = await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => a.eventType)).toEqual(['DECISION_CREATED', 'DECISION_APPROVED']);
  });

  it('reject → REJECTED with reason; approve/reject require ADMIN (401 / 403); unknown id → 404', async () => {
    const { app, adminCookie, viewerCookie } = await setup();
    const evalRes = await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: adminCookie } });
    const id = evalRes.json().data.decisions[0].id as string;

    expect((await app.inject({ method: 'POST', url: `${API}/recommendations/${id}/approve` })).statusCode).toBe(401);
    const forbidden = await app.inject({ method: 'POST', url: `${API}/recommendations/${id}/reject`, headers: { cookie: viewerCookie }, payload: {} });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN_NOT_ADMIN');
    expect((await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: viewerCookie } })).statusCode).toBe(403);

    const rej = await app.inject({
      method: 'POST',
      url: `${API}/recommendations/${id}/reject`,
      headers: { cookie: adminCookie },
      payload: { reason: 'not now' },
    });
    expect(rej.statusCode).toBe(200);
    expect(rej.json().data).toMatchObject({ status: 'REJECTED', rejectReason: 'not now', rejectedBy: admin.address });

    const missing = await app.inject({ method: 'GET', url: `${API}/recommendations/dec_missing` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });

  it('expired recommendation cannot be approved (409, status EXPIRED)', async () => {
    const { app, adminCookie } = await setup();
    const id = (await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: adminCookie } })).json().data
      .decisions[0].id as string;
    await prisma.agentDecision.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await app.inject({ method: 'POST', url: `${API}/recommendations/${id}/approve`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toEqual({ status: 'EXPIRED' });
    expect((await prisma.agentDecision.findUnique({ where: { id } }))?.status).toBe('EXPIRED');
  });

  it('Auto Mode: PUT mode AUTO → next tick creates APPROVED and executes without approval', async () => {
    const { app, adminCookie, enqueued } = await setup();
    const put = await app.inject({ method: 'PUT', url: `${API}/agent/settings`, headers: { cookie: adminCookie }, payload: { mode: 'AUTO' } });
    expect(put.statusCode).toBe(200);
    const d = (await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: adminCookie } })).json().data.decisions[0];
    expect(d).toMatchObject({ status: 'APPROVED', mode: 'AUTO' });
    await vi.waitFor(() => expect(enqueued).toEqual([d.id]));
  });

  it('GET/PUT /agent/settings: defaults, partial update, bounds re-checked after merge, audited', async () => {
    const { app, adminCookie, viewerCookie } = await setup();
    const get = await app.inject({ method: 'GET', url: `${API}/agent/settings` });
    expect(get.statusCode).toBe(200);
    expect(get.json().data).toMatchObject({ mode: 'APPROVE', minActionAmount: expect.any(String) });

    expect((await app.inject({ method: 'PUT', url: `${API}/agent/settings`, payload: { mode: 'AUTO' } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'PUT', url: `${API}/agent/settings`, headers: { cookie: viewerCookie }, payload: { mode: 'AUTO' } }))
        .statusCode,
    ).toBe(403);

    const bad = await app.inject({
      method: 'PUT',
      url: `${API}/agent/settings`,
      headers: { cookie: adminCookie },
      payload: { riskWithdrawThreshold: 99 }, // ≥ stored riskInvestThreshold
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const unknownField = await app.inject({ method: 'PUT', url: `${API}/agent/settings`, headers: { cookie: adminCookie }, payload: { foo: 1 } });
    expect(unknownField.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url: `${API}/agent/settings`,
      headers: { cookie: adminCookie },
      payload: { mode: 'AUTO', minApyBps: 300, minActionAmount: '5000000' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ mode: 'AUTO', minApyBps: 300, minActionAmount: '5000000' });
    expect((await app.inject({ method: 'GET', url: `${API}/agent/settings` })).json().data.mode).toBe('AUTO');
    const events = (await prisma.auditLog.findMany({ where: { entityType: 'SETTINGS' } })).map((a) => a.eventType).sort();
    expect(events).toEqual(['MODE_CHANGED', 'SETTINGS_CHANGED']);
  });

  it('GET /agent/activity merges decisions, actions and keeper runs (newest first)', async () => {
    const { app, adminCookie } = await setup({ withKeeper: true });
    await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie: adminCookie } });
    await prisma.keeperRun.create({
      data: { treasuryId: 'local-musdc', chainTime: 1, shortfallBefore: '0', enforced: false, paidIds: '["1"]', txHashes: '[]', errors: '[]' },
    });
    const res = await app.inject({ method: 'GET', url: `${API}/agent/activity?limit=10` });
    expect(res.statusCode).toBe(200);
    const types = (res.json().data as { type: string; at: number }[]).map((i) => i.type).sort();
    expect(types).toEqual(['DECISION', 'KEEPER_RUN']);
    const bad = await app.inject({ method: 'GET', url: `${API}/agent/activity?limit=1000` });
    expect(bad.statusCode).toBe(400);
  });

  it('keeper: GET /keeper/status and POST /keeper/run (admin)', async () => {
    const { app, adminCookie, viewerCookie, keeperTick } = await setup({ withKeeper: true });
    const status = await app.inject({ method: 'GET', url: `${API}/keeper/status` });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toMatchObject({ enabled: true, keeperAddress: viewer.address, avaxBalance: '2000000000000000000', lastRunAt: null });

    expect((await app.inject({ method: 'POST', url: `${API}/keeper/run`, headers: { cookie: viewerCookie } })).statusCode).toBe(403);
    const run = await app.inject({ method: 'POST', url: `${API}/keeper/run`, headers: { cookie: adminCookie } });
    expect(run.statusCode).toBe(200);
    expect(run.json().data).toMatchObject({ paidIds: ['1'], txHashes: ['0xabc'] });
    expect(keeperTick).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: 'GET', url: `${API}/keeper/status` })).json().data.lastRunAt).toEqual(expect.any(Number));
  });

  it('without a scheduler: evaluate / keeper run → 409 INVALID_STATE, keeper status disabled', async () => {
    const chain = new FakeChain();
    chain.admins.add(admin.address);
    const { app } = await makeApp(chain);
    const cookie = await loginCookie(app, admin);
    const ev = await app.inject({ method: 'POST', url: `${API}/agent/evaluate`, headers: { cookie } });
    expect(ev.statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `${API}/keeper/run`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `${API}/keeper/status` })).json().data).toMatchObject({ enabled: false, keeperAddress: null });
  });
});
