// Display / gating helpers for RecommendationCard (docs/08 §2, §8). Pure functions so they are unit-tested.
import type { DecisionStatus, TransactionStatus } from '@runwaymind/shared';
import { formatUsdc } from '@runwaymind/shared';
import type { AgentDecisionJson } from './api';

/** Polling stops once a decision reaches one of these (docs/07 §7: poll every 2 s until EXECUTED/BLOCKED_BY_POLICY). */
export const TERMINAL_DECISION_STATUSES: readonly DecisionStatus[] = [
  'EXECUTED',
  'BLOCKED_BY_POLICY',
  'FAILED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
];

export const DECISION_POLL_MS = 2_000;

export function isTerminalDecision(status: DecisionStatus): boolean {
  return TERMINAL_DECISION_STATUSES.includes(status);
}

export interface AdminGate {
  enabled: boolean;
  reason: string | null;
}

/**
 * Approve/Reject are ADMIN-only (docs/08 §2, §8 "Not ADMIN: disabled with tooltip 'Requires ADMIN role'"). The
 * on-chain `hasRole` check is a UI convenience; the API re-checks the SIWE session's role.
 */
export function adminGate(input: { isConnected: boolean; isAdmin: boolean; isSignedIn: boolean }): AdminGate {
  if (!input.isConnected) return { enabled: false, reason: 'Connect wallet to manage' };
  if (!input.isAdmin) return { enabled: false, reason: 'Requires ADMIN role' };
  // The same gate guards every ADMIN control (settings, vault, obligations…), so the reason stays generic.
  if (!input.isSignedIn) return { enabled: false, reason: 'Sign in (SIWE) to manage' };
  return { enabled: true, reason: null };
}

/** Whether the Approve/Reject buttons should be offered at all for this decision. */
export function isActionable(decision: Pick<AgentDecisionJson, 'status' | 'expiresAt'>, chainTime: number): boolean {
  return decision.status === 'PENDING_APPROVAL' && (chainTime <= 0 || decision.expiresAt > chainTime);
}

/** "expires in 9m 30s" / "expires in 2h 05m" / "expired" — countdown against chain time. */
export function expiryLabel(expiresAt: number, now: number): string {
  const left = expiresAt - now;
  if (left <= 0) return 'expired';
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  if (h > 0) return `expires in ${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `expires in ${m}m ${String(s).padStart(2, '0')}s`;
  return `expires in ${s}s`;
}

/** Headline from the explanation, or a deterministic fallback when no explanation exists yet. */
export function decisionHeadline(d: Pick<AgentDecisionJson, 'explanation' | 'action' | 'amount'>): string {
  if (d.explanation?.headline) return d.explanation.headline;
  const verb = d.action.replace(/_/g, ' ').toLowerCase();
  const title = verb.charAt(0).toUpperCase() + verb.slice(1);
  return d.amount ? `${title} ${formatUsdc(BigInt(d.amount))} USDC` : title;
}

/** Latest on-chain action of a decision (the one carrying the tx hash / decoded error). */
export function latestAction(d: Pick<AgentDecisionJson, 'actions'>) {
  return d.actions.length ? d.actions[d.actions.length - 1] : undefined;
}

/** Map a decision status to the tx status shown in its toast. */
export function decisionTxStatus(status: DecisionStatus): TransactionStatus {
  switch (status) {
    case 'EXECUTED':
      return 'CONFIRMED';
    case 'BLOCKED_BY_POLICY':
    case 'FAILED':
      return 'REVERTED';
    case 'REJECTED':
    case 'EXPIRED':
    case 'SUPERSEDED':
      return 'DROPPED';
    default:
      return 'PENDING';
  }
}
