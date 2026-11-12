// Risk classes (docs/06 §2.3 runway SAFE/WATCH/CRITICAL, docs/06 §3 pool band HEALTHY/WATCH/CRITICAL).
// Color is never the only signal (docs/08 §9): every badge carries an icon AND the class name as text, and all
// text/background pairs meet WCAG AA (≥ 4.5:1).
export type RiskLevel = 'SAFE' | 'HEALTHY' | 'WATCH' | 'CRITICAL';

export const RISK_LEVELS: readonly RiskLevel[] = ['SAFE', 'HEALTHY', 'WATCH', 'CRITICAL'];

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

interface RiskStyle {
  icon: string;
  /** Badge: background + text + ring. */
  badge: string;
  /** Text-only usage (e.g. the big runway number) on a white / light background. */
  text: string;
  /** Panel/banner: border + background + text. */
  panel: string;
  description: string;
}

const OK: Omit<RiskStyle, 'description'> = {
  icon: '✓',
  badge: 'bg-emerald-100 text-emerald-900 ring-emerald-700/40',
  text: 'text-emerald-800',
  panel: 'border-emerald-600 bg-emerald-50 text-emerald-900',
};

export const RISK_STYLE: Record<RiskLevel, RiskStyle> = {
  SAFE: { ...OK, description: 'Safe' },
  HEALTHY: { ...OK, description: 'Healthy' },
  WATCH: {
    icon: '⚠',
    badge: 'bg-amber-100 text-amber-900 ring-amber-700/40',
    text: 'text-amber-800',
    panel: 'border-amber-500 bg-amber-50 text-amber-950',
    description: 'Watch',
  },
  CRITICAL: {
    icon: '✕',
    badge: 'bg-red-100 text-red-900 ring-red-700/40',
    text: 'text-red-800',
    panel: 'border-red-500 bg-red-50 text-red-900',
    description: 'Critical',
  },
};

export function RiskBadge({ level, size = 'sm', className = '' }: { level: RiskLevel; size?: 'sm' | 'lg'; className?: string }) {
  const s = RISK_STYLE[level];
  const sizeCls = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      data-risk={level}
      className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset ${s.badge} ${sizeCls} ${className}`}
    >
      <span aria-hidden>{s.icon}</span>
      {level}
    </span>
  );
}
