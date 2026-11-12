// Prisma implementation of the agent persistence port (agent/src/orchestrator/store.ts) and audit sink (docs/09 §3).
import { randomUUID } from 'node:crypto';
import type { AgentAction, AgentDecision, Prisma, PrismaClient } from '@prisma/client';
import type {
  ActionPatch,
  ActionRecord,
  AgentStore,
  AuditEntry,
  AuditSink,
  DecisionPatch,
  DecisionRecord,
  KeeperRunFinish,
  KeeperRunStart,
  NewAction,
  NewDecision,
  TransactionInput,
} from '@runwaymind/agent';
import { OPEN_DECISION_STATUSES } from '@runwaymind/agent';
import {
  stringifyJson,
  type AgentActionStatus,
  type AgentActionType,
  type AgentMode,
  type Address,
  type CashLadderResult,
  type AdapterState,
  type ChainSnapshot,
  type DecisionStatus,
  type PoolMetricSample,
  type PoolRiskResult,
  type Explanation,
  type ReasonCode,
} from '@runwaymind/shared';
import type { Repositories } from './index';

export function toPoolSample(row: {
  adapterAddress: string;
  sampledAt: number;
  blockNumber: string;
  apyBps: number;
  utilizationBps: number;
  tvl: string;
  availableLiquidity: string;
  paused: boolean;
}): PoolMetricSample {
  return {
    adapterAddress: row.adapterAddress as Address,
    sampledAt: row.sampledAt,
    blockNumber: BigInt(row.blockNumber),
    apyBps: row.apyBps,
    utilizationBps: row.utilizationBps,
    tvl: BigInt(row.tvl),
    availableLiquidity: BigInt(row.availableLiquidity),
    paused: row.paused,
  };
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '')}`;

export function toDecisionRecord(row: AgentDecision): DecisionRecord {
  const explanation = row.explanation ? (JSON.parse(row.explanation) as Explanation) : null;
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    action: row.action as AgentActionType,
    adapter: (row.adapter as Address | null) ?? null,
    amount: row.amount === null ? null : BigInt(row.amount),
    reasonCode: row.reasonCode as ReasonCode,
    status: row.status as DecisionStatus,
    mode: row.mode as AgentMode,
    facts: JSON.parse(row.facts),
    explanation: explanation ? { ...explanation, source: (row.explanationSource as Explanation['source']) ?? explanation.source } : null,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    rejectedBy: row.rejectedBy,
    rejectReason: row.rejectReason,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toActionRecord(row: AgentAction): ActionRecord {
  return {
    id: row.id,
    decisionId: row.decisionId,
    functionName: row.functionName as ActionRecord['functionName'],
    args: JSON.parse(row.args) as unknown[],
    status: row.status as AgentActionStatus,
    txHash: row.txHash,
    decodedError: row.decodedError ? JSON.parse(row.decodedError) : null,
    gasUsed: row.gasUsed === null ? null : BigInt(row.gasUsed),
    blockNumber: row.blockNumber === null ? null : BigInt(row.blockNumber),
    attempt: row.attempt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function decisionPatchData(p: DecisionPatch): Prisma.AgentDecisionUpdateManyMutationInput {
  const data: Prisma.AgentDecisionUpdateManyMutationInput = { status: p.status };
  if (p.amount !== undefined) data.amount = p.amount === null ? null : p.amount.toString();
  if (p.approvedBy !== undefined) data.approvedBy = p.approvedBy;
  if (p.approvedAt !== undefined) data.approvedAt = p.approvedAt;
  if (p.rejectedBy !== undefined) data.rejectedBy = p.rejectedBy;
  if (p.rejectReason !== undefined) data.rejectReason = p.rejectReason;
  if (p.explanation !== undefined) {
    data.explanation = p.explanation ? stringifyJson(p.explanation) : null;
    data.explanationSource = p.explanation?.source ?? null;
  }
  return data;
}

export class PrismaAgentStore implements AgentStore, AuditSink {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repos: Repositories,
  ) {}

  private get treasuryId() {
    return this.repos.treasuryId;
  }

  getSettings() {
    return this.repos.agentSettings();
  }

  async obligationLabels() {
    const m = await this.repos.metadataByObligation();
    return Object.fromEntries([...m.entries()].map(([id, v]) => [id, v.label]));
  }

  async saveSnapshot(s: ChainSnapshot, l: CashLadderResult) {
    await this.prisma.chainSnapshotRecord.create({
      data: {
        id: s.snapshotId,
        treasuryId: this.treasuryId,
        blockNumber: s.blockNumber.toString(),
        chainTime: s.chainTime,
        data: stringifyJson(s),
        ladder: { create: { result: stringifyJson(l) } },
      },
    });
    // Retention (docs/09 §7): keep the last 2,000 snapshots.
    const old = await this.prisma.chainSnapshotRecord.findMany({
      where: { treasuryId: this.treasuryId },
      orderBy: { createdAt: 'desc' },
      skip: 2_000,
      select: { id: true },
    });
    if (old.length) {
      const ids = old.map((o) => o.id);
      await this.prisma.ladderSnapshot.deleteMany({ where: { snapshotId: { in: ids } } });
      await this.prisma.chainSnapshotRecord.deleteMany({ where: { id: { in: ids } } });
    }
  }

  /** docs/09 §3 PoolMetricSample, newest first. */
  async poolHistory(adapter: Address, limit: number): Promise<PoolMetricSample[]> {
    const rows = await this.prisma.poolMetricSample.findMany({
      where: { adapterAddress: adapter },
      orderBy: [{ sampledAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toPoolSample);
  }

  /** Upserts the Pool row, then stores one PoolMetricSample + PoolRiskSnapshot per adapter (docs/06 §4.1). */
  async savePoolMetrics(snapshotId: string, adapters: readonly AdapterState[], samples: readonly PoolMetricSample[], risks: readonly PoolRiskResult[]) {
    await this.prisma.$transaction(async (tx) => {
      for (const a of adapters) {
        await tx.pool.upsert({
          where: { adapterAddress: a.address },
          create: { adapterAddress: a.address, poolAddress: '', treasuryId: this.treasuryId, name: a.name, kind: /aave/i.test(a.name) ? 'AAVE_V3' : 'MOCK' },
          update: { name: a.name },
        });
      }
      for (const x of samples) {
        await tx.poolMetricSample.create({
          data: {
            adapterAddress: x.adapterAddress,
            sampledAt: x.sampledAt,
            blockNumber: x.blockNumber.toString(),
            apyBps: x.apyBps,
            utilizationBps: x.utilizationBps,
            tvl: x.tvl.toString(),
            availableLiquidity: x.availableLiquidity.toString(),
            paused: x.paused,
          },
        });
      }
      for (const r of risks) {
        await tx.poolRiskSnapshot.create({
          data: {
            adapterAddress: r.adapter,
            snapshotId,
            score: r.score,
            band: r.band,
            components: JSON.stringify({ ...r.components, weights: r.weights, samplesUsed: r.samplesUsed }),
            computedAt: r.computedAt,
          },
        });
      }
    });
  }

  async listOpenDecisions() {
    const rows = await this.prisma.agentDecision.findMany({
      where: { treasuryId: this.treasuryId, status: { in: [...OPEN_DECISION_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDecisionRecord);
  }

  async getDecision(id: string) {
    const row = await this.prisma.agentDecision.findFirst({ where: { id, treasuryId: this.treasuryId } });
    return row ? toDecisionRecord(row) : null;
  }

  async createDecision(d: NewDecision) {
    const row = await this.prisma.agentDecision.create({
      data: {
        id: newId('dec'),
        treasuryId: this.treasuryId,
        snapshotId: d.snapshotId,
        action: d.action,
        adapter: d.adapter,
        amount: d.amount === null ? null : d.amount.toString(),
        reasonCode: d.reasonCode,
        status: d.status,
        mode: d.mode,
        facts: stringifyJson(d.facts),
        explanation: d.explanation ? stringifyJson(d.explanation) : null,
        explanationSource: d.explanation?.source ?? null,
        approvedBy: d.approvedBy ?? null,
        approvedAt: d.approvedAt ?? null,
        expiresAt: d.expiresAt,
      },
    });
    return toDecisionRecord(row);
  }

  async transitionDecision(id: string, from: readonly DecisionStatus[], patch: DecisionPatch) {
    const res = await this.prisma.agentDecision.updateMany({
      where: { id, treasuryId: this.treasuryId, status: { in: [...from] } },
      data: decisionPatchData(patch),
    });
    if (res.count !== 1) return null;
    return this.getDecision(id);
  }

  async expireDecisions(now: Date) {
    const due = await this.prisma.agentDecision.findMany({
      where: { treasuryId: this.treasuryId, status: 'PENDING_APPROVAL', expiresAt: { lte: now } },
    });
    const out: DecisionRecord[] = [];
    for (const d of due) {
      const r = await this.transitionDecision(d.id, ['PENDING_APPROVAL'], { status: 'EXPIRED' });
      if (r) out.push(r);
    }
    return out;
  }

  async createAction(a: NewAction) {
    const row = await this.prisma.agentAction.create({
      data: {
        id: newId('act'),
        decisionId: a.decisionId,
        functionName: a.functionName,
        args: stringifyJson(a.args),
        status: a.status,
        attempt: a.attempt ?? 1,
      },
    });
    return toActionRecord(row);
  }

  async updateAction(id: string, p: ActionPatch) {
    const data: Prisma.AgentActionUpdateInput = {};
    if (p.status !== undefined) data.status = p.status;
    if (p.txHash !== undefined) data.txHash = p.txHash;
    if (p.decodedError !== undefined) data.decodedError = p.decodedError ? stringifyJson(p.decodedError) : null;
    if (p.gasUsed !== undefined) data.gasUsed = p.gasUsed === null ? null : p.gasUsed.toString();
    if (p.blockNumber !== undefined) data.blockNumber = p.blockNumber === null ? null : p.blockNumber.toString();
    if (p.attempt !== undefined) data.attempt = p.attempt;
    return toActionRecord(await this.prisma.agentAction.update({ where: { id }, data }));
  }

  async listActions(decisionId: string) {
    const rows = await this.prisma.agentAction.findMany({ where: { decisionId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toActionRecord);
  }

  async upsertTransaction(t: TransactionInput) {
    await this.repos.upsertTransaction(t);
  }

  async startKeeperRun(r: KeeperRunStart) {
    const row = await this.prisma.keeperRun.create({
      data: {
        id: newId('kr'),
        treasuryId: this.treasuryId,
        startedAt: r.startedAt,
        chainTime: r.chainTime,
        shortfallBefore: r.shortfallBefore.toString(),
        enforced: false,
        paidIds: '[]',
        txHashes: '[]',
        errors: '[]',
      },
    });
    return row.id;
  }

  async finishKeeperRun(id: string, r: KeeperRunFinish) {
    await this.prisma.keeperRun.update({
      where: { id },
      data: {
        finishedAt: r.finishedAt,
        enforced: r.enforced,
        paidIds: stringifyJson(r.paidIds),
        txHashes: stringifyJson(r.txHashes),
        errors: stringifyJson(r.errors),
      },
    });
  }

  // AuditSink
  async write(e: AuditEntry) {
    // entityType is kept even without an entityId (e.g. a failed NL_PARSE has no draft id), docs/05 §11.
    await this.repos.audit(e.eventType, e.actor, e.payload, e.entityType ? { type: e.entityType, id: e.entityId ?? null } : undefined);
  }
}
