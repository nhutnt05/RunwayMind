// Prisma access (docs/14 §1 repositories/). Services depend on these, never on PrismaClient directly.
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_AGENT_SETTINGS, stringifyJson, type AgentSettings, type ObligationSource } from '@runwaymind/shared';
import type { TransactionInput } from '@runwaymind/agent';

export type TransactionUpsert = TransactionInput;

/** Events that move principal between Treasury and adapters (accruedYield, docs/07 §4.1). */
export const PRINCIPAL_EVENTS = ['Invested', 'Withdrawn', 'DeadlineEnforced', 'ObligationPaid'] as const;

/**
 * Principal change for one indexed event: Invested +amount; Withdrawn −received; DeadlineEnforced −withdrawn;
 * ObligationPaid −pulled (liquidity pulled from adapters inside pay(), measured by the indexer from the receipt's
 * asset transfers into the Treasury, since _pullLiquidity emits no per-adapter event).
 */
export function principalDelta(name: string, args: Record<string, unknown>): bigint {
  const n = (k: string) => BigInt(String(args[k] ?? '0'));
  if (name === 'Invested') return n('amount');
  if (name === 'Withdrawn') return -n('received');
  if (name === 'DeadlineEnforced') return -n('withdrawn');
  if (name === 'ObligationPaid') return -n('pulled');
  return 0n;
}

export interface MetadataView {
  label: string;
  notes: string | null;
  source: ObligationSource;
}

export function createRepositories(prisma: PrismaClient, treasuryId: string) {
  return {
    treasuryId,

    async treasuryConfig() {
      return prisma.treasuryConfig.findUnique({ where: { id: treasuryId } });
    },

    async metadataByObligation(): Promise<Map<string, MetadataView>> {
      const rows = await prisma.obligationMetadata.findMany({ where: { treasuryId } });
      return new Map(rows.map((r) => [r.obligationId, { label: r.label, notes: r.notes, source: r.source as ObligationSource }]));
    },

    async pendingRecommendationCount(): Promise<number> {
      return prisma.agentDecision.count({ where: { treasuryId, status: 'PENDING_APPROVAL' } });
    },

    async inflows() {
      const rows = await prisma.expectedInflow.findMany({ where: { treasuryId }, orderBy: { expectedDate: 'asc' } });
      return rows.map((r) => ({ id: r.id, label: r.label, amount: BigInt(r.amount), expectedDate: r.expectedDate }));
    },

    async agentSettings() {
      const row = await prisma.agentSettings.findUnique({ where: { treasuryId } });
      if (!row) return DEFAULT_AGENT_SETTINGS;
      return {
        mode: row.mode as 'APPROVE' | 'AUTO',
        minApyBps: row.minApyBps,
        riskInvestThreshold: row.riskInvestThreshold,
        riskWithdrawThreshold: row.riskWithdrawThreshold,
        minActionAmount: BigInt(row.minActionAmount),
        preWithdrawLeadDays: row.preWithdrawLeadDays,
        decisionTtlSec: row.decisionTtlSec,
        loopIntervalSec: row.loopIntervalSec,
      };
    },

    /** Net principal deposited per adapter from indexed Invested/Withdrawn events (docs/07 §4.1 accruedYield). */
    async netPrincipal(): Promise<{ indexed: boolean; principal: bigint }> {
      const cursor = await prisma.chainEventCursor.findUnique({ where: { treasuryId } });
      if (!cursor) return { indexed: false, principal: 0n };
      const events = await prisma.indexedEvent.findMany({
        where: { treasuryId, name: { in: [...PRINCIPAL_EVENTS] } },
      });
      let principal = 0n;
      for (const e of events) {
        principal += principalDelta(e.name, JSON.parse(e.args) as Record<string, unknown>);
      }
      return { indexed: true, principal };
    },

    async obligationPayments(obligationId: string) {
      const rows = await prisma.indexedEvent.findMany({
        where: { treasuryId, name: 'ObligationPaid' },
        orderBy: { blockNumber: 'asc' },
      });
      return rows
        .map((r) => ({ row: r, args: JSON.parse(r.args) as Record<string, string> }))
        .filter((x) => x.args.id === obligationId)
        .map(({ row, args }) => ({
          txHash: row.txHash,
          blockNumber: row.blockNumber,
          chainTime: row.chainTime,
          occurrence: Number(args.occurrence ?? 0),
          amount: args.amount ?? '0',
          recipient: args.recipient ?? null,
        }));
    },

    // ---- transactions (docs/09 Transaction) ----
    /** Insert or merge a tracked transaction. Never downgrades CONFIRMED/REVERTED back to PENDING. */
    async upsertTransaction(t: TransactionUpsert) {
      const existing = await prisma.transaction.findUnique({ where: { hash: t.hash } });
      const final = (s: string) => s === 'CONFIRMED' || s === 'REVERTED';
      const status = existing && final(existing.status) && t.status === 'PENDING' ? existing.status : t.status;
      const decoded = t.decodedEvents ? stringifyJson(t.decodedEvents) : null;
      if (!existing) {
        await prisma.transaction.create({
          data: {
            hash: t.hash,
            treasuryId,
            kind: t.kind,
            fromAddress: t.from,
            initiator: t.initiator,
            status,
            blockNumber: t.blockNumber === null ? null : t.blockNumber.toString(),
            decodedEvents: decoded,
            error: t.error ? stringifyJson(t.error) : null,
            relatedId: t.relatedId,
            confirmedAt: t.confirmedAt ?? null,
          },
        });
        return;
      }
      await prisma.transaction.update({
        where: { hash: t.hash },
        data: {
          // the initiator that tracked the tx (AGENT / KEEPER / ADMIN_UI) wins over INDEXER
          ...(existing.initiator === 'INDEXER' && t.initiator !== 'INDEXER'
            ? { initiator: t.initiator, kind: t.kind, fromAddress: t.from, relatedId: t.relatedId ?? existing.relatedId }
            : {}),
          ...(existing.kind === 'OTHER' && t.kind !== 'OTHER' ? { kind: t.kind } : {}),
          ...(existing.relatedId === null && t.relatedId ? { relatedId: t.relatedId } : {}),
          status,
          ...(t.blockNumber !== null ? { blockNumber: t.blockNumber.toString() } : {}),
          ...(decoded ? { decodedEvents: decoded } : {}),
          ...(t.error ? { error: stringifyJson(t.error) } : {}),
          ...(t.confirmedAt && !existing.confirmedAt ? { confirmedAt: t.confirmedAt } : {}),
        },
      });
    },

    async getTransaction(hash: string) {
      return prisma.transaction.findFirst({ where: { treasuryId, hash } });
    },

    async listTransactions(q: { kind?: string | undefined; status?: string | undefined; limit: number; cursor?: string | undefined }) {
      const rows = await prisma.transaction.findMany({
        where: { treasuryId, ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { hash: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { hash: q.cursor }, skip: 1 } : {}),
      });
      const more = rows.length > q.limit;
      const items = rows.slice(0, q.limit);
      return { items, nextCursor: more ? (items[items.length - 1]?.hash ?? null) : null };
    },

    async listAuditLogs(q: { entityType?: string | undefined; entityId?: string | undefined; limit: number }) {
      return prisma.auditLog.findMany({
        where: { treasuryId, ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
        orderBy: { id: 'desc' },
        take: q.limit,
      });
    },

    // ---- decisions ----
    async listDecisions(q: { status?: string | undefined; limit: number }) {
      return prisma.agentDecision.findMany({
        where: { treasuryId, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        include: { actions: { orderBy: { createdAt: 'asc' } } },
      });
    },

    async getDecisionWithActions(id: string) {
      return prisma.agentDecision.findFirst({ where: { id, treasuryId }, include: { actions: { orderBy: { createdAt: 'asc' } } } });
    },

    async recentActions(limit: number) {
      return prisma.agentAction.findMany({ where: { decision: { treasuryId } }, orderBy: { createdAt: 'desc' }, take: limit });
    },

    async recentKeeperRuns(limit: number) {
      return prisma.keeperRun.findMany({ where: { treasuryId }, orderBy: { startedAt: 'desc' }, take: limit });
    },

    async saveAgentSettings(s: AgentSettings, by: string) {
      const data = { ...s, minActionAmount: s.minActionAmount.toString(), updatedBy: by };
      await prisma.agentSettings.upsert({ where: { treasuryId }, create: { treasuryId, ...data }, update: data });
    },

    // ---- event index (docs/09 IndexedEvent, ChainEventCursor) ----
    async eventCursor(): Promise<bigint | null> {
      const c = await prisma.chainEventCursor.findUnique({ where: { treasuryId } });
      return c ? BigInt(c.lastBlock) : null;
    },

    async setEventCursor(block: bigint) {
      await prisma.chainEventCursor.upsert({
        where: { treasuryId },
        create: { treasuryId, lastBlock: block.toString() },
        update: { lastBlock: block.toString() },
      });
    },

    async upsertIndexedEvent(e: { id: string; name: string; blockNumber: bigint; txHash: string; args: unknown; chainTime: number | null }) {
      const data = { treasuryId, name: e.name, blockNumber: e.blockNumber.toString(), txHash: e.txHash, args: stringifyJson(e.args), chainTime: e.chainTime };
      await prisma.indexedEvent.upsert({ where: { id: e.id }, create: { id: e.id, ...data }, update: data });
    },

    // ---- obligation drafts / metadata (docs/07 §5.1–§5.3) ----
    async getDraft(id: string) {
      return prisma.obligationDraft.findFirst({ where: { id, treasuryId } });
    },

    async saveDraft(d: {
      id: string;
      status: string;
      source: string;
      label: string;
      notes?: string | null;
      category: string;
      recipient: string | null;
      amount: string;
      firstDueDate: number;
      interval: number;
      maxOccurrences: number;
      warnings: string[];
      sourceText: string | null;
      createdBy: string;
    }) {
      const data = { ...d, treasuryId, warnings: JSON.stringify(d.warnings) };
      await prisma.obligationDraft.upsert({ where: { id: d.id }, create: data, update: data });
    },

    async setDraftStatus(id: string, status: string) {
      await prisma.obligationDraft.updateMany({ where: { id, treasuryId }, data: { status } });
    },

    async getMetadata(obligationId: string) {
      return prisma.obligationMetadata.findUnique({ where: { treasuryId_obligationId: { treasuryId, obligationId } } });
    },

    async upsertMetadata(m: {
      obligationId: string;
      label: string;
      notes: string | null;
      source: string;
      nlDraftId: string | null;
      metadataHash: string;
      createTxHash: string;
    }) {
      await prisma.obligationMetadata.upsert({
        where: { treasuryId_obligationId: { treasuryId, obligationId: m.obligationId } },
        create: { treasuryId, ...m },
        update: m,
      });
    },

    async updateMetadataText(obligationId: string, patch: { label?: string; notes?: string | null }) {
      await prisma.obligationMetadata.update({ where: { treasuryId_obligationId: { treasuryId, obligationId } }, data: patch });
    },

    // ---- auth ----
    async createNonce(nonce: string, expiresAt: Date) {
      await prisma.authNonce.create({ data: { nonce, expiresAt } });
    },

    /** Marks the nonce used; returns false if missing, expired or already used. */
    async consumeNonce(nonce: string, now: Date): Promise<boolean> {
      const res = await prisma.authNonce.updateMany({
        where: { nonce, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      return res.count === 1;
    },

    async upsertWallet(address: string, roles: string[], now: Date) {
      await prisma.wallet.upsert({
        where: { address },
        create: { address, cachedRoles: JSON.stringify(roles), rolesCheckedAt: now, lastSeenAt: now },
        update: { cachedRoles: JSON.stringify(roles), rolesCheckedAt: now, lastSeenAt: now },
      });
    },

    async audit(eventType: string, actor: string, payload: unknown, entity?: { type: string; id?: string | null }) {
      await prisma.auditLog.create({
        data: {
          treasuryId,
          eventType,
          actor,
          entityType: entity?.type ?? null,
          entityId: entity?.id ?? null,
          payload: JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
        },
      });
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
