// Pool Risk Score gauge (A-11): 0–100, higher = safer. Shows the score, what the band means for the treasury, and
// where the score sits on the 0–39 / 40–69 / 70–100 scale, so the number reads without the docs.
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon } from '@/components/ui/icons';

export type RiskBand = 'HEALTHY' | 'WATCH' | 'CRITICAL';

export const BAND_INFO: Record<RiskBand, { color: string; label: string; range: string; meaning: string; text: string; bg: string }> = {
  HEALTHY: { color: '#059669', label: 'Healthy', range: '70–100', meaning: 'Safe — the agent may invest here.', text: 'text-emerald-800', bg: 'bg-emerald-50' },
  WATCH: { color: '#d97706', label: 'Watch', range: '40–69', meaning: 'Caution — no new deposits, funds stay.', text: 'text-amber-900', bg: 'bg-amber-50' },
  CRITICAL: { color: '#dc2626', label: 'Critical', range: '0–39', meaning: 'Risky — the agent withdraws everything.', text: 'text-red-800', bg: 'bg-red-50' },
};

const BAND_ICON = { HEALTHY: CheckCircleIcon, WATCH: AlertTriangleIcon, CRITICAL: XCircleIcon } as const;
const SCALE: { band: RiskBand; from: number; to: number }[] = [
  { band: 'CRITICAL', from: 0, to: 40 },
  { band: 'WATCH', from: 40, to: 70 },
  { band: 'HEALTHY', from: 70, to: 100 },
];

export function RiskScoreGauge({ score, band }: { score: number; band: RiskBand }) {
  const info = BAND_INFO[band];
  const Icon = BAND_ICON[band];
  const clamped = Math.max(0, Math.min(100, score));
  const arc = Math.PI * 50;
  return (
    <div className="w-full max-w-[260px]" data-testid="risk-score-gauge">
      <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-500">Safety score</p>
      <svg viewBox="0 0 120 66" className="mx-auto h-24 w-full max-w-[200px]" role="img" aria-label={`Safety score ${score} out of 100 (higher is safer): ${info.label}`}>
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke={info.color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(arc * clamped) / 100} ${arc}`} />
        <text x="60" y="52" textAnchor="middle" fontSize="22" fontWeight="700" fill="#0f172a">
          {score}
        </text>
        <text x="60" y="64" textAnchor="middle" fontSize="8" fill="#475569">
          out of 100
        </text>
      </svg>
      <p className="text-center text-xs text-slate-600">Higher is safer</p>

      {/* Scale with the three bands and a marker at the current score. */}
      <div className="relative mt-3" aria-hidden>
        <div className="flex h-2 overflow-hidden rounded-full">
          {SCALE.map((s) => (
            <div key={s.band} style={{ width: `${s.to - s.from}%`, background: BAND_INFO[s.band].color, opacity: s.band === band ? 1 : 0.3 }} />
          ))}
        </div>
        <div className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-slate-900 ring-2 ring-white" style={{ left: `${clamped}%` }} />
        <div className="mt-1 flex text-[10px] text-slate-600">
          {SCALE.map((s) => (
            <span key={s.band} className="text-center" style={{ width: `${s.to - s.from}%` }}>
              {BAND_INFO[s.band].label}
            </span>
          ))}
        </div>
      </div>

      <p className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${info.bg} ${info.text}`} data-testid="risk-band-meaning">
        <Icon className="mt-px h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">
            {info.label} ({info.range})
          </span>{' '}
          — {info.meaning}
        </span>
      </p>
    </div>
  );
}
