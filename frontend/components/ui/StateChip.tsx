import { RiskBadge, isRiskLevel } from './RiskBadge';

// Color is never the only signal (docs/08 §9): every chip shows an icon and text.
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-sky-100 text-sky-800',
  neutral: 'bg-slate-100 text-slate-700',
};

const TONE_ICON: Record<Tone, string> = { success: '●', warning: '▲', danger: '■', info: '◆', neutral: '○' };

// Known state values across docs (risk class, pool band, obligation derived state, decision status).
const STATE_TONE: Record<string, Tone> = {
  SAFE: 'success',
  HEALTHY: 'success',
  EXECUTED: 'success',
  CONFIRMED: 'success',
  PAID: 'success',
  ACTIVE: 'success',
  WATCH: 'warning',
  IN_WINDOW: 'warning',
  PENDING_APPROVAL: 'warning',
  DUE: 'warning',
  WITHDRAW_ONLY: 'warning',
  CRITICAL: 'danger',
  OVERDUE: 'danger',
  BLOCKED_BY_POLICY: 'danger',
  REVERTED: 'danger',
  FAILED: 'danger',
  SCHEDULED: 'info',
  APPROVED: 'info',
  EXECUTING: 'info',
};

export function StateChip({ state, tone }: { state: string; tone?: Tone }) {
  // Risk classes always render through RiskBadge so SAFE/WATCH/CRITICAL look the same everywhere.
  if (!tone && isRiskLevel(state)) return <RiskBadge level={state} />;
  const t = tone ?? STATE_TONE[state] ?? 'neutral';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[t]}`}>
      <span aria-hidden>{TONE_ICON[t]}</span>
      {state.replace(/_/g, ' ')}
    </span>
  );
}
