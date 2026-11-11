// Prisma access (docs/14 §1 repositories/). Services depend on these, never on PrismaClient directly.
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_AGENT_SETTINGS, type ObligationSource } from '@runwaymind/shared';

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
        where: { treasuryId, name: { in: ['Invested', 'Withdrawn'] } },
      });
      let principal = 0n;
      for (const e of events) {
        const args = JSON.parse(e.args) as { amount?: string; received?: string };
        if (e.name === 'Invested') principal += BigInt(args.amount ?? '0');
        else principal -= BigInt(args.received ?? '0');
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

    async audit(eventType: string, actor: string, payload: unknown, entity?: { type: string; id: string }) {
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
