'use client';

// Agent mode confirmation (replaces window.confirm, docs/08 §3.8). Switching mode is an app setting saved through
// PUT /agent/settings (audited as MODE_CHANGED): no blockchain transaction, no wallet prompt, no fee.
import { useId, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, Spinner } from '@/components/ui/icons';

export type AgentMode = 'APPROVE' | 'AUTO';

const COPY: Record<AgentMode, { title: string; subtitle: string; points: ReactNode[]; confirm: string; keep: string }> = {
  AUTO: {
    title: 'Switch to AUTO mode?',
    subtitle: 'The agent will invest and withdraw on its own, without waiting for your approval.',
    points: [
      'Recommendations are executed automatically as soon as the agent makes them.',
      <>
        Every action is still checked on-chain by the safety rules <strong>R1–R6</strong> (reserve, exposure caps, pool health…); anything that breaks a
        rule is rejected.
      </>,
      'You can switch back to APPROVE at any time.',
    ],
    confirm: 'Switch to AUTO',
    keep: 'Stay in APPROVE',
  },
  APPROVE: {
    title: 'Switch back to APPROVE mode?',
    subtitle: 'New recommendations will wait for an ADMIN approval before anything is executed.',
    points: [
      'The agent keeps analysing the treasury and proposing actions.',
      'Nothing is invested or withdrawn until an ADMIN approves it.',
      'You can switch to AUTO again at any time.',
    ],
    confirm: 'Switch to APPROVE',
    keep: 'Stay in AUTO',
  },
};

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY = `${BTN} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const CONFIRM: Record<AgentMode, string> = {
  AUTO: `${BTN} bg-amber-700 text-white hover:bg-amber-800`, // amber-700: white text passes AA (amber-600 does not)
  APPROVE: `${BTN} bg-slate-900 text-white hover:bg-slate-800`,
};

export interface ModeSwitchDialogProps {
  open: boolean;
  /** The mode the user is switching TO. */
  target: AgentMode;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ModeSwitchDialog({ open, target, pending, error, onConfirm, onClose }: ModeSwitchDialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const c = COPY[target];
  const auto = target === 'AUTO';
  return (
    <Modal open={open} onClose={onClose} dismissible={!pending} labelledBy={titleId} describedBy={descId}>
      <div data-testid="mode-switch-dialog" data-target={target}>
        <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${
              auto ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-sky-50 text-sky-700 ring-sky-200'
            }`}
          >
            {auto ? <AlertTriangleIcon /> : <CheckCircleIcon />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {c.title}
            </h2>
            <p id={descId} className="mt-0.5 text-sm text-slate-600">
              {c.subtitle}
            </p>
          </div>
          {!pending ? (
            <button type="button" onClick={onClose} className="-mr-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Close dialog">
              <CloseIcon />
            </button>
          ) : null}
        </div>

        <div className="space-y-3 px-5 pb-5 sm:px-6">
          <section aria-label="What changes" className={`rounded-xl border p-4 text-sm ${auto ? 'border-amber-200 bg-amber-50/70 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-800'}`}>
            <h3 className="font-semibold">What changes</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {c.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
          <p className="text-xs text-slate-500">This is an app setting: no blockchain transaction, no wallet signature and no fee. The change is recorded in the audit log.</p>
          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <span className="font-semibold">Could not change the mode.</span> {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" data-autofocus onClick={onClose} disabled={pending} className={SECONDARY}>
            {c.keep}
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className={CONFIRM[target]}>
            {pending ? (
              <>
                <Spinner /> Switching…
              </>
            ) : (
              c.confirm
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
