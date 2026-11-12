// Auto Mode (docs/05 §8, REQ-046). In AUTO the agent's own rules approve decisions and the AGENT key executes them;
// on-chain policy R1–R6 is enforced identically in both modes. TRIP_CIRCUIT_BREAKER and WITHDRAW* are always
// auto-approvable; INVEST only when it came from rule P6 (`IDLE_SURPLUS`: all P6 conditions held). HOLD is
// informational and never approved.
import type { AgentActionType, AgentMode, DecisionStatus, ReasonCode } from '@runwaymind/shared';
import type { AuditLogger } from '../audit/audit';
import type { DecisionRecord } from './store';

export const AUTO_ACTOR = 'system';

/** Whether Auto Mode may approve this decision without an ADMIN click. */
export function autoApprovable(d: { action: AgentActionType; reasonCode: ReasonCode }): boolean {
  switch (d.action) {
    case 'WITHDRAW':
    case 'WITHDRAW_ALL':
    case 'TRIP_CIRCUIT_BREAKER':
      return true;
    case 'INVEST':
      return d.reasonCode === 'IDLE_SURPLUS';
    default:
      return false;
  }
}

/** Status a newly created rule decision starts in: APPROVED in Auto Mode when approvable, else PENDING_APPROVAL. */
export function initialStatus(mode: AgentMode, d: { action: AgentActionType; reasonCode: ReasonCode }): DecisionStatus {
  return mode === 'AUTO' && autoApprovable(d) ? 'APPROVED' : 'PENDING_APPROVAL';
}

export interface AutoExecuteDeps {
  audit: AuditLogger;
  executor?: { enqueue(decisionId: string): Promise<unknown> } | null;
}

/**
 * Audits each auto-approved decision (`DECISION_APPROVED`, actor `system`) and hands it to the executor.
 * Execution is fire-and-forget: the executor drives EXECUTING → EXECUTED | BLOCKED_BY_POLICY | FAILED.
 * Returns the ids that were enqueued (none when no executor is configured: they stay APPROVED until one is).
 */
export async function executeAutoApproved(deps: AutoExecuteDeps, created: readonly DecisionRecord[]): Promise<string[]> {
  const approved = created.filter((d) => d.mode === 'AUTO' && d.status === 'APPROVED');
  for (const d of approved) {
    await deps.audit.record(
      'DECISION_APPROVED',
      { action: d.action, amount: d.amount, adapter: d.adapter, mode: 'AUTO' },
      { actor: AUTO_ACTOR, entityType: 'DECISION', entityId: d.id },
    );
  }
  if (!deps.executor) return [];
  for (const d of approved) void deps.executor.enqueue(d.id);
  return approved.map((d) => d.id);
}
