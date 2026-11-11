// Approve Mode (docs/05 §8, docs/07 §7, ADR-003): ADMIN approves off-chain (SIWE + on-chain role check done by the
// backend), then the AGENT key executes. Transitions: PENDING_APPROVAL → APPROVED | REJECTED | EXPIRED.
import type { AuditLogger } from '../audit/audit';
import type { AgentStore, DecisionRecord } from './store';

export class ApprovalError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_STATE',
    message: string,
    readonly status?: string,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface ApprovalDeps {
  store: AgentStore;
  audit: AuditLogger;
  executor?: { enqueue(decisionId: string): Promise<unknown> } | null;
  now?: () => Date;
}

export function createApprovalService(deps: ApprovalDeps) {
  const now = deps.now ?? (() => new Date());

  async function loadPending(id: string): Promise<DecisionRecord> {
    const d = await deps.store.getDecision(id);
    if (!d) throw new ApprovalError('NOT_FOUND', `Recommendation ${id} not found`);
    if (d.status !== 'PENDING_APPROVAL') {
      throw new ApprovalError('INVALID_STATE', `Recommendation is ${d.status}, expected PENDING_APPROVAL`, d.status);
    }
    if (d.expiresAt.getTime() <= now().getTime()) {
      const res = await deps.store.transitionDecision(id, ['PENDING_APPROVAL'], { status: 'EXPIRED' });
      if (res) await deps.audit.record('DECISION_EXPIRED', { expiresAt: d.expiresAt.toISOString() }, { entityType: 'DECISION', entityId: id });
      throw new ApprovalError('INVALID_STATE', 'Recommendation expired', 'EXPIRED');
    }
    return d;
  }

  return {
    /** PENDING_APPROVAL → APPROVED, then enqueues execution asynchronously (client polls the decision). */
    async approve(id: string, by: string): Promise<DecisionRecord> {
      await loadPending(id);
      const res = await deps.store.transitionDecision(id, ['PENDING_APPROVAL'], {
        status: 'APPROVED',
        approvedBy: by,
        approvedAt: now(),
      });
      if (!res) throw new ApprovalError('INVALID_STATE', 'Recommendation changed state concurrently');
      await deps.audit.record('DECISION_APPROVED', { action: res.action, amount: res.amount, adapter: res.adapter }, {
        actor: by,
        entityType: 'DECISION',
        entityId: id,
      });
      if (deps.executor) void deps.executor.enqueue(id);
      return res;
    },

    async reject(id: string, by: string, reason?: string): Promise<DecisionRecord> {
      await loadPending(id);
      const res = await deps.store.transitionDecision(id, ['PENDING_APPROVAL'], {
        status: 'REJECTED',
        rejectedBy: by,
        rejectReason: reason ?? null,
      });
      if (!res) throw new ApprovalError('INVALID_STATE', 'Recommendation changed state concurrently');
      await deps.audit.record('DECISION_REJECTED', { reason: reason ?? null }, { actor: by, entityType: 'DECISION', entityId: id });
      return res;
    },
  };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
