'use client';

import { useId, type ButtonHTMLAttributes } from 'react';
import type { AdminGate } from '@/lib/recommendations';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Admin gate (docs/08 §8): wallet connected + on-chain ADMIN + SIWE session. */
  gate: AdminGate;
};

/**
 * ADMIN-only button (docs/08 §8 "Not ADMIN → admin buttons disabled with tooltip"). When the gate is closed the
 * button is disabled, carries the reason as a native `title`, is described by it for assistive tech
 * (`aria-describedby`), and shows a styled tooltip on hover — the wrapper receives the hover because disabled
 * buttons swallow pointer events in some browsers. Other disabled conditions (busy, invalid input) stay the
 * caller's `disabled` prop.
 */
export function GatedButton({ gate, disabled, title, className = '', children, ...rest }: Props) {
  const tipId = useId();
  const blocked = !gate.enabled;
  const reason = gate.reason ?? 'Requires ADMIN role';
  return (
    <span className="group relative inline-flex" title={blocked ? reason : undefined}>
      <button
        type="button"
        {...rest}
        disabled={blocked || disabled}
        title={blocked ? reason : title}
        aria-describedby={blocked ? tipId : rest['aria-describedby']}
        className={`disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        {children}
      </button>
      {blocked ? (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block"
        >
          <span aria-hidden>🔒 </span>
          {reason}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Visible, keyboard-reachable explanation of why admin controls are disabled (disabled buttons cannot take focus,
 * so the tooltip alone is not enough for keyboard users). Renders nothing when the gate is open.
 */
export function AdminGateNotice({ gate, context = 'Admin controls are read-only.' }: { gate: AdminGate; context?: string }) {
  if (gate.enabled) return null;
  return (
    <p
      role="note"
      data-testid="admin-gate-notice"
      className="mb-4 flex items-start gap-2 rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-800"
    >
      <span aria-hidden>🔒</span>
      <span>
        <strong className="font-semibold">{gate.reason}</strong> — {context}
      </span>
    </p>
  );
}
