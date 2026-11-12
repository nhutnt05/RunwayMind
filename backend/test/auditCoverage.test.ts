// D7-B1: every docs/05 §11 AuditLog event type is (1) emitted by production code and (2) persisted as an AuditLog row
// (docs/09) with actor / entityType / entityId / JSON payload (bigints as strings) / createdAt, readable via
// GET /audit-logs. Behavioural coverage of each emitter lives in agent/test (reliability, orchestrator, auto, explain)
// and backend/test (agent, vault, analytics); this file guards against an event type silently losing its emitter.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEventType } from '@runwaymind/shared';
import { makeApp, prisma, resetDb } from './helpers';

/** docs/05 §11, in document order. */
const DOCS_05_11 = [
  'AGENT_TICK',
  'DECISION_CREATED',
  'DECISION_APPROVED',
  'DECISION_REJECTED',
  'DECISION_EXPIRED',
  'DECISION_SUPERSEDED',
  'ACTION_SIMULATION_REVERTED',
  'ACTION_SENT',
  'ACTION_CONFIRMED',
  'ACTION_FAILED',
  'KEEPER_PAY',
  'KEEPER_ENFORCE',
  'MODE_CHANGED',
  'SETTINGS_CHANGED',
  'NL_PARSE',
  'ENGINE_MISMATCH',
  'LLM_FALLBACK',
] as const satisfies readonly AuditEventType[];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('AuditLog coverage (docs/05 §11, docs/09)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('every docs/05 §11 event type is passed to audit.record(...) somewhere in agent/src or backend/src', () => {
    const root = resolve(__dirname, '../..');
    const emitted = new Set<string>();
    for (const file of [...sources(join(root, 'agent/src')), ...sources(join(root, 'backend/src'))]) {
      const text = readFileSync(file, 'utf8');
      // First argument of each `.record(` call; ternaries such as `policy ? 'A' : 'B'` contribute both literals.
      for (const m of text.matchAll(/\.record\(\s*([^,]+),/g)) {
        for (const lit of m[1]!.matchAll(/'([A-Z_]+)'/g)) emitted.add(lit[1]!);
      }
    }
    expect(DOCS_05_11.filter((t) => !emitted.has(t))).toEqual([]);
  });

  it('each event type is persisted as an AuditLog row and served by GET /audit-logs with string amounts', async () => {
    const { app, bundles, primaryId } = await makeApp();
    const audit = bundles.get(primaryId)!.audit;
    for (const [i, t] of DOCS_05_11.entries()) {
      await audit.record(t, { amount: 20_000_000_000n, nested: { shortfall: 5n } }, { actor: i % 2 ? '0xAdmin' : 'system', entityType: 'DECISION', entityId: `e_${t}` });
    }
    // entityType is kept without an entityId (e.g. a failed NL_PARSE)
    await audit.record('NL_PARSE', { ok: false }, { actor: '0xAdmin', entityType: 'NL' });

    const rows = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.eventType)).toEqual([...DOCS_05_11, 'NL_PARSE']);
    for (const r of rows.slice(0, DOCS_05_11.length)) {
      expect(r).toMatchObject({ entityType: 'DECISION', entityId: `e_${r.eventType}`, createdAt: expect.any(Date) });
      expect(JSON.parse(r.payload)).toEqual({ amount: '20000000000', nested: { shortfall: '5' } });
    }
    expect(rows.at(-1)).toMatchObject({ entityType: 'NL', entityId: null, actor: '0xAdmin' });

    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs?limit=100' });
    expect(res.statusCode).toBe(200);
    const served = res.json().data as { eventType: string; payload: unknown }[];
    expect(new Set(served.map((s) => s.eventType))).toEqual(new Set(DOCS_05_11));
    expect(served.find((s) => s.eventType === 'KEEPER_ENFORCE')?.payload).toEqual({ amount: '20000000000', nested: { shortfall: '5' } });
  });
});
