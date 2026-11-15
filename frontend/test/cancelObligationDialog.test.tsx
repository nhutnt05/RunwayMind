// Cancel-obligation dialog (replaces window.confirm): every state renders from the obligation passed in (no
// hard-coded data), shows the on-chain notice before confirming, and failures are explained in plain language.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CancelObligationDialogView,
  isDismissible,
  type CancelObligationDialogViewProps,
  type CancelPhase,
} from '../components/obligations/CancelObligationDialog';
import type { ObligationItem } from '../lib/api';
import { classifyTxError } from '../lib/txErrors';

const HASH = `0x${'ab'.repeat(32)}` as const;
const DUE = 1_794_000_000; // 2026-11-06 UTC

const obligation: ObligationItem = {
  id: '7',
  recipient: '0x00000000000000000000000000000000000000A1',
  amount: '20000000000', // 20,000.00
  nextDueDate: DUE,
  interval: 0,
  maxOccurrences: 1,
  paidOccurrences: 0,
  category: 'PAYROLL',
  status: 'ACTIVE',
  withdrawalDeadline: DUE - 14 * 86_400,
  derivedState: 'IN_WINDOW',
  metadata: { label: 'Lương tháng 12', notes: null, source: 'FORM' },
};

const noop = () => undefined;
const view = (phase: CancelPhase, extra: Partial<CancelObligationDialogViewProps> = {}) =>
  renderToStaticMarkup(
    <CancelObligationDialogView
      open
      obligation={obligation}
      context={{ assetSymbol: 'mUSDC', assetAddress: '0x00000000000000000000000000000000000000C1', chainTime: DUE - 5 * 86_400, demoStartTime: null }}
      phase={phase}
      hash={null}
      failure={null}
      onConfirm={noop}
      onClose={noop}
      onRetry={noop}
      {...extra}
    />,
  );

describe('CancelObligationDialogView', () => {
  it('confirm state: real obligation data, on-chain notice, Keep + Cancel actions', () => {
    const html = view('confirm');
    expect(html).toContain('Cancel Obligation');
    expect(html).toContain('Review this action before proceeding.');
    expect(html).toContain('Lương tháng 12');
    expect(html).toContain('20,000.00');
    expect(html).toContain('mUSDC');
    expect(html).toContain('06/11/26 UTC');
    expect(html).toContain('in 5 days');
    expect(html).toContain('IN WINDOW');
    expect(html).toContain('On-chain Action');
    expect(html).toContain('Canceling this obligation will submit an on-chain transaction. This action may be irreversible once confirmed.');
    expect(html).toContain('network fee');
    expect(html).toContain('Keep Obligation');
    expect(html).toMatch(/aria-labelledby="[^"]+-title"/);
    expect(html).not.toContain('role="alert"');
  });

  it('falls back to "Obligation #id" when there is no label', () => {
    const html = renderToStaticMarkup(
      <CancelObligationDialogView
        open
        obligation={{ ...obligation, metadata: null }}
        context={{ assetSymbol: null, assetAddress: null, chainTime: 0, demoStartTime: null }}
        phase="confirm"
        hash={null}
        failure={null}
        onConfirm={noop}
        onClose={noop}
        onRetry={noop}
      />,
    );
    expect(html).toContain('Obligation #7');
  });

  it('wallet state: wallet step is current, the destructive action is disabled, no close button', () => {
    const html = view('wallet');
    expect(html).toContain('Confirm in Your Wallet');
    expect(html).toMatch(/aria-current="step"[^>]*>.*Confirm in wallet/s);
    expect(html).toContain('Waiting for wallet…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Waiting for wallet…/s);
    expect(html).not.toContain('aria-label="Close dialog"');
    expect(html).not.toContain('On-chain Action');
  });

  it('confirming state: shows the submitted tx hash and may be closed', () => {
    const html = view('confirming', { hash: HASH });
    expect(html).toContain('Waiting for blockchain confirmation');
    expect(html).toContain(`/tx/${HASH}`);
    expect(html).toContain('aria-label="Close dialog"');
  });

  it('success state: confirmation, tx hash and explorer link', () => {
    const html = view('success', { hash: HASH });
    expect(html).toContain('Obligation cancelled successfully.');
    expect(html).toContain(`/tx/${HASH}`);
    expect(html).toContain('View on Snowtrace');
    expect(html).toContain('Done');
  });

  it('failed state: plain-language reason, technical detail, retry only when it can help', () => {
    const rejected = view('failed', { failure: classifyTxError('Wallet / wallet RPC: User rejected the request.') });
    expect(rejected).toContain('Transaction rejected in wallet');
    expect(rejected).toContain('Nothing was sent to the network');
    expect(rejected).toContain('Try Again');
    expect(rejected).toContain('role="alert"');

    const reverted = view('failed', { failure: classifyTxError('Simulation (app RPC): ObligationNotActive: 0=7'), hash: null });
    expect(reverted).toContain('Transaction reverted');
    expect(reverted).not.toContain('Try Again');
    expect(reverted).toContain('ObligationNotActive');
  });

  it('cannot be dismissed while preparing or waiting for the wallet', () => {
    expect(isDismissible('confirm')).toBe(true);
    expect(isDismissible('preparing')).toBe(false);
    expect(isDismissible('wallet')).toBe(false);
    expect(isDismissible('confirming')).toBe(true);
    expect(isDismissible('success')).toBe(true);
    expect(isDismissible('failed')).toBe(true);
  });

  it('renders nothing inside the dialog when closed', () => {
    const html = renderToStaticMarkup(
      <CancelObligationDialogView
        open={false}
        obligation={null}
        context={{ assetSymbol: null, assetAddress: null, chainTime: 0, demoStartTime: null }}
        phase="confirm"
        hash={null}
        failure={null}
        onConfirm={noop}
        onClose={noop}
        onRetry={noop}
      />,
    );
    expect(html).not.toContain('Cancel Obligation');
  });
});

describe('classifyTxError', () => {
  it.each([
    ['Wallet / wallet RPC: User rejected the request.', 'USER_REJECTED', true],
    ['Wallet / wallet RPC: The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account. (insufficient funds for gas)', 'INSUFFICIENT_FUNDS', true],
    ['Waiting for receipt: Transaction reverted', 'REVERTED', false],
    ['Simulation (app RPC): ObligationNotActive: 0=3', 'REVERTED', false],
    ['Backend prepare: Failed to fetch', 'NETWORK', true],
    ['Wallet / wallet RPC: HTTP request failed. (Status: 429)', 'NETWORK', true],
    ['Wallet / wallet RPC: something unexpected', 'UNKNOWN', true],
  ])('%s → %s', (message, kind, retryable) => {
    const f = classifyTxError(message);
    expect(f.kind).toBe(kind);
    expect(f.retryable).toBe(retryable);
    expect(f.detail).toBe(message);
  });
});
