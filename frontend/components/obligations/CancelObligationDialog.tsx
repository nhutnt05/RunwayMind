'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AddressChip, AmountText, SnowtraceLink, StateChip } from '@/components/ui';
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircleIcon,
  CloseIcon,
  LinkChainIcon,
  Spinner,
  WalletIcon,
  XCircleIcon,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useRegistryWrite, type RegistryWriteProgress } from '@/hooks/useRegistryWrite';
import { api, type ObligationItem, type PrepareTxResponse } from '@/lib/api';
import { countdown, dayLabel } from '@/lib/dashboard';
import { intervalLabel } from '@/lib/obligationForm';
import { classifyTxError, type TxFailure } from '@/lib/txErrors';

/** Dialog lifecycle: review → prepare/simulate → wallet prompt → on-chain confirmation → success | failed. */
export type CancelPhase = 'confirm' | 'preparing' | 'wallet' | 'confirming' | 'success' | 'failed';

export interface CancelDialogContext {
  /** Token the Treasury holds (from the treasury overview), e.g. "mUSDC". */
  assetSymbol: string | null;
  assetAddress: string | null;
  chainTime: number;
  demoStartTime: number | null;
}

// ---- container --------------------------------------------------------------------------------------------------

/**
 * Cancel-obligation confirmation (replaces `window.confirm`). Runs the existing registry write flow unchanged
 * (`POST /obligations/:id/cancel` → simulate → wallet → receipt, hooks/useRegistryWrite.ts) and shows its progress.
 * Closing the dialog before confirming never sends anything; a ref guard makes double clicks start one flow only.
 */
export function CancelObligationDialog({
  obligation,
  context,
  onClose,
}: {
  /** The obligation to cancel (a snapshot taken when the dialog opened); null = closed. */
  obligation: ObligationItem | null;
  context: CancelDialogContext;
  onClose: () => void;
}) {
  const write = useRegistryWrite();
  const [phase, setPhase] = useState<CancelPhase>('confirm');
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [failure, setFailure] = useState<TxFailure | null>(null);
  const inFlight = useRef(false);

  const reset = () => {
    setPhase('confirm');
    setHash(null);
    setFailure(null);
  };

  const close = () => {
    if (!isDismissible(phase)) return;
    reset();
    onClose();
  };

  const confirm = () => {
    if (!obligation || inFlight.current) return; // double-click / repeated Enter: one flow only
    inFlight.current = true;
    setFailure(null);
    setHash(null);
    setPhase('preparing');
    const name = obligationName(obligation);
    write
      .mutateAsync({
        title: `Cancel obligation ${name}`,
        kind: 'CANCEL_OBLIGATION',
        functionName: 'cancelObligation',
        prepare: () => api.post<PrepareTxResponse>(`/obligations/${encodeURIComponent(obligation.id)}/cancel`),
        onProgress: (p: RegistryWriteProgress) => {
          if (p.phase === 'wallet') setPhase('wallet');
          else if (p.phase === 'confirming') {
            setHash(p.hash);
            setPhase('confirming');
          } else setPhase('preparing');
        },
      })
      .then((res) => {
        if (res.hash) setHash(res.hash);
        setPhase('success');
      })
      .catch((e: unknown) => {
        setFailure(classifyTxError(e instanceof Error ? e.message : String(e)));
        setPhase('failed');
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  return (
    <CancelObligationDialogView
      open={obligation !== null}
      obligation={obligation}
      context={context}
      phase={phase}
      hash={hash}
      failure={failure}
      onConfirm={confirm}
      onClose={close}
      onRetry={confirm}
    />
  );
}

/** The dialog may close only when no wallet prompt or preparation is pending (after a hash it keeps tracking in toasts). */
export function isDismissible(phase: CancelPhase): boolean {
  return phase !== 'preparing' && phase !== 'wallet';
}

function obligationName(o: ObligationItem): string {
  return o.metadata?.label ?? `Obligation #${o.id}`;
}

// ---- view -------------------------------------------------------------------------------------------------------

export interface CancelObligationDialogViewProps {
  open: boolean;
  obligation: ObligationItem | null;
  context: CancelDialogContext;
  phase: CancelPhase;
  hash: `0x${string}` | null;
  failure: TxFailure | null;
  onConfirm: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export function CancelObligationDialogView(props: CancelObligationDialogViewProps) {
  const { open, obligation, phase, onClose } = props;
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const dismissible = isDismissible(phase);
  const rootRef = useRef<HTMLDivElement>(null);

  // Move focus to the safe/primary action of each state (Keep Obligation, Done, Close). Runs after Modal's own
  // effect (children's effects run first), i.e. after showModal().
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [open, phase]);

  return (
    <Modal open={open} onClose={onClose} dismissible={dismissible} labelledBy={titleId} describedBy={descId}>
      {obligation ? (
        <div ref={rootRef} data-testid="cancel-obligation-dialog" data-phase={phase} className="flex flex-col">
          <Header phase={phase} titleId={titleId} descId={descId} onClose={dismissible ? onClose : null} />
          <div className="space-y-4 px-5 pb-5 sm:px-6">
            <ObligationSummary o={obligation} context={props.context} />
            {phase === 'confirm' ? <OnChainNotice titleId={`${uid}-notice`} /> : null}
            {phase === 'preparing' || phase === 'wallet' || phase === 'confirming' ? <Progress phase={phase} hash={props.hash} /> : null}
            {phase === 'success' ? <SuccessPanel hash={props.hash} /> : null}
            {phase === 'failed' && props.failure ? <FailurePanel failure={props.failure} hash={props.hash} /> : null}
          </div>
          <Footer {...props} />
        </div>
      ) : null}
    </Modal>
  );
}

const HEADER: Record<CancelPhase, { title: string; subtitle: string; tone: 'warn' | 'busy' | 'ok' | 'error' }> = {
  confirm: { title: 'Cancel Obligation', subtitle: 'Review this action before proceeding.', tone: 'warn' },
  preparing: { title: 'Cancelling Obligation', subtitle: 'Preparing and simulating the transaction.', tone: 'busy' },
  wallet: { title: 'Confirm in Your Wallet', subtitle: 'Approve the request in Core or your connected wallet.', tone: 'busy' },
  confirming: { title: 'Processing Transaction', subtitle: 'Waiting for blockchain confirmation.', tone: 'busy' },
  success: { title: 'Obligation Cancelled', subtitle: 'The cancellation is confirmed on-chain.', tone: 'ok' },
  failed: { title: 'Cancellation Not Completed', subtitle: 'The obligation was not cancelled.', tone: 'error' },
};

const TONE_ICON = {
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  busy: 'bg-slate-100 text-slate-700 ring-slate-200',
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
} as const;

function Header({ phase, titleId, descId, onClose }: { phase: CancelPhase; titleId: string; descId: string; onClose: (() => void) | null }) {
  const h = HEADER[phase];
  const icon =
    h.tone === 'ok' ? <CheckCircleIcon /> : h.tone === 'error' ? <XCircleIcon /> : phase === 'wallet' ? <WalletIcon /> : h.tone === 'busy' ? <Spinner className="h-5 w-5" /> : <AlertTriangleIcon />;
  return (
    <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${TONE_ICON[h.tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-base font-semibold text-slate-900">
          {h.title}
        </h2>
        <p id={descId} className="mt-0.5 text-sm text-slate-600">
          {h.subtitle}
        </p>
      </div>
      {onClose ? (
        <button type="button" onClick={onClose} className="-mr-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Close dialog">
          <CloseIcon />
        </button>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function ObligationSummary({ o, context }: { o: ObligationItem; context: CancelDialogContext }) {
  const due = dayLabel(o.nextDueDate);
  return (
    <dl aria-label="Obligation details" className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/60 px-4">
      <Row label="Obligation">
        <span className="font-medium">{obligationName(o)}</span>
        <span className="block font-mono text-xs text-slate-500">
          #{o.id} · {o.category.replace(/_/g, ' ')}
        </span>
      </Row>
      <Row label="Amount">
        <span className="text-base font-semibold">
          <AmountText value={o.amount} />
        </span>
        {o.interval !== 0 ? <span className="block text-xs text-slate-500">per occurrence · {intervalLabel(o.interval)}</span> : null}
      </Row>
      <Row label="Asset">
        <span className="font-medium">{context.assetSymbol ?? '—'}</span>
        {context.assetAddress ? (
          <span className="block">
            <AddressChip address={context.assetAddress as `0x${string}`} />
          </span>
        ) : null}
      </Row>
      <Row label="Due date">
        <span>{due} UTC</span>
        {o.status === 'ACTIVE' ? <span className="block text-xs text-slate-500">{countdown(o.nextDueDate, context.chainTime)}</span> : null}
      </Row>
      <Row label="Recipient">
        <AddressChip address={o.recipient} />
      </Row>
      <Row label="Status">
        <StateChip state={o.derivedState} />
      </Row>
    </dl>
  );
}

function OnChainNotice({ titleId }: { titleId: string }) {
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
      <h3 id={titleId} className="flex items-center gap-2 font-semibold">
        <LinkChainIcon className="h-4 w-4" />
        On-chain Action
      </h3>
      <p className="mt-1">Canceling this obligation will submit an on-chain transaction. This action may be irreversible once confirmed.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900">
        <li>The cancellation is recorded on Avalanche and stops all future payments of this obligation.</li>
        <li>Your wallet (Core or the connected wallet) will ask you to confirm the transaction.</li>
        <li>A small network fee in AVAX is paid from the connected wallet.</li>
        <li>The obligation is only cancelled once the blockchain confirms the transaction.</li>
      </ul>
    </section>
  );
}

const STEPS: { key: 'preparing' | 'wallet' | 'confirming'; label: string; active: string }[] = [
  { key: 'preparing', label: 'Prepare & simulate', active: 'Checking the cancellation against the contract…' },
  { key: 'wallet', label: 'Confirm in wallet', active: 'Waiting for your approval in the wallet…' },
  { key: 'confirming', label: 'Blockchain confirmation', active: 'Transaction submitted. Waiting for blockchain confirmation…' },
];

function Progress({ phase, hash }: { phase: 'preparing' | 'wallet' | 'confirming'; hash: `0x${string}` | null }) {
  const current = STEPS.findIndex((s) => s.key === phase);
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-slate-200 p-4">
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.key} className="flex items-start gap-3" aria-current={active ? 'step' : undefined}>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done ? 'bg-emerald-600 text-white' : active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? '✓' : active ? <Spinner className="h-3 w-3" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm ${active ? 'font-semibold text-slate-900' : done ? 'text-slate-700' : 'text-slate-500'}`}>
                  {s.label}
                  {done ? <span className="sr-only"> (done)</span> : null}
                </p>
                {active ? <p className="text-xs text-slate-600">{s.active}</p> : null}
                {s.key === 'confirming' && hash ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Tx <SnowtraceLink kind="tx" value={hash} />
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {phase === 'confirming' ? (
        <p className="mt-3 text-xs text-slate-500">You can close this window; the transaction keeps being tracked in the notifications.</p>
      ) : null}
    </div>
  );
}

function SuccessPanel({ hash }: { hash: `0x${string}` | null }) {
  return (
    <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950">
      <p className="font-medium">Obligation cancelled successfully.</p>
      <p className="mt-1 text-emerald-900">No further payments will be made for it, and the reserve is recalculated.</p>
      {hash ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 ring-1 ring-emerald-200">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Transaction</span>
          <SnowtraceLink kind="tx" value={hash}>
            {hash.slice(0, 10)}…{hash.slice(-8)} · View on Snowtrace
          </SnowtraceLink>
        </div>
      ) : null}
    </div>
  );
}

function FailurePanel({ failure, hash }: { failure: TxFailure; hash: `0x${string}` | null }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50/60 p-4 text-sm text-red-950">
      <p className="font-semibold">{failure.title}</p>
      <p className="mt-1 text-red-900">{failure.help}</p>
      {hash ? (
        <p className="mt-2 text-xs text-slate-700">
          Submitted transaction: <SnowtraceLink kind="tx" value={hash} />
        </p>
      ) : null}
      <details className="mt-2 text-xs text-slate-700">
        <summary className="cursor-pointer select-none font-medium">Technical details</summary>
        <p className="mt-1 break-words font-mono">{failure.detail}</p>
      </details>
    </div>
  );
}

const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY = `${BTN} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
const DESTRUCTIVE = `${BTN} bg-red-700 text-white hover:bg-red-800`;
const PRIMARY = `${BTN} bg-slate-900 text-white hover:bg-slate-800`;

function Footer({ phase, failure, onConfirm, onClose, onRetry }: CancelObligationDialogViewProps) {
  const busy = phase === 'preparing' || phase === 'wallet' || phase === 'confirming';
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
      {phase === 'confirm' ? (
        <>
          {/* The safe action gets focus on open: Enter/Space right away keeps the obligation. */}
          <button type="button" data-autofocus onClick={onClose} className={SECONDARY}>
            Keep Obligation
          </button>
          <button type="button" onClick={onConfirm} className={DESTRUCTIVE}>
            <BanIcon className="h-4 w-4" />
            Cancel Obligation
          </button>
        </>
      ) : null}
      {busy ? (
        <>
          <button type="button" onClick={onClose} disabled={phase !== 'confirming'} className={SECONDARY}>
            {phase === 'confirming' ? 'Close' : 'Keep Obligation'}
          </button>
          <button type="button" disabled aria-disabled="true" className={DESTRUCTIVE}>
            <Spinner />
            {phase === 'wallet' ? 'Waiting for wallet…' : phase === 'confirming' ? 'Confirming…' : 'Preparing…'}
          </button>
        </>
      ) : null}
      {phase === 'success' ? (
        <button type="button" data-autofocus onClick={onClose} className={PRIMARY}>
          Done
        </button>
      ) : null}
      {phase === 'failed' ? (
        <>
          <button type="button" data-autofocus onClick={onClose} className={SECONDARY}>
            Close
          </button>
          {failure?.retryable ? (
            <button type="button" onClick={onRetry} className={DESTRUCTIVE}>
              <BanIcon className="h-4 w-4" />
              Try Again
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
