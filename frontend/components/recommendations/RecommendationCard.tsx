import { AmountText, AddressChip, GatedButton, SnowtraceLink, StateChip } from '@/components/ui';
import type { AgentDecisionJson } from '@/lib/api';
import { formatDecodedError } from '@/lib/preparedTx';
import { decisionHeadline, expiryLabel, isActionable, latestAction, type AdminGate } from '@/lib/recommendations';

export interface RecommendationCardProps {
  decision: AgentDecisionJson;
  /**
   * Wall-clock Unix seconds. Approval TTLs (`expiresAt`) are operational wall-clock times set and enforced by the
   * backend (agent/src/orchestrator/approval.ts) — NOT chain time, which jumps ahead with demo time travel (CP2 B-12).
   */
  nowSec: number;
  gate: AdminGate;
  busy?: 'approve' | 'reject' | null;
  error?: string | null;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

/**
 * Agent recommendation (docs/08 §2): headline, explanation, reasons, amount, expiry countdown and ADMIN-only
 * Approve / Reject. A policy-blocked decision turns red with the decoded rule (docs/08 §8).
 */
export function RecommendationCard({ decision, nowSec, gate, busy = null, error, onApprove, onReject }: RecommendationCardProps) {
  const ex = decision.explanation;
  const blocked = decision.status === 'BLOCKED_BY_POLICY';
  const action = latestAction(decision);
  const actionable = isActionable(decision, nowSec);
  const headingId = `rec-${decision.id}-title`;

  return (
    <article
      aria-labelledby={headingId}
      data-status={decision.status}
      className={`rounded-xl border p-4 shadow-sm ${blocked ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <h3 id={headingId} className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
          {decisionHeadline(decision)}
        </h3>
        <StateChip state={decision.status} />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        {decision.amount ? <AmountText value={decision.amount} className="text-sm font-semibold text-slate-900" /> : null}
        {decision.adapter ? <AddressChip address={decision.adapter} /> : null}
        <span>{decision.reasonCode.replace(/_/g, ' ')}</span>
        {decision.status === 'PENDING_APPROVAL' ? <span>{expiryLabel(decision.expiresAt, nowSec)}</span> : null}
        {ex ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
            {ex.source === 'LLM' ? 'AI explanation' : 'Template'}
          </span>
        ) : null}
      </div>

      {ex?.explanation ? <p className="mt-2 text-sm text-slate-800">{ex.explanation}</p> : null}
      {ex?.reasons.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
          {ex.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {ex?.riskNote ? <p className="mt-2 text-xs text-amber-800">Risk: {ex.riskNote}</p> : null}

      {blocked && action?.decodedError ? (
        <p className="mt-2 text-xs font-semibold text-red-800">Blocked by policy — {formatDecodedError(action.decodedError)}</p>
      ) : null}
      {action?.txHash ? (
        <p className="mt-2 text-xs">
          <SnowtraceLink kind="tx" value={action.txHash}>
            View transaction on Snowtrace
          </SnowtraceLink>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}

      {actionable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <GatedButton
            gate={gate}
            disabled={busy !== null}
            onClick={() => onApprove?.(decision.id)}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </GatedButton>
          <GatedButton
            gate={gate}
            disabled={busy !== null}
            onClick={() => onReject?.(decision.id)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </GatedButton>
          {gate.reason ? (
            <span className="text-xs text-slate-700">
              <span aria-hidden>🔒 </span>
              {gate.reason}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
