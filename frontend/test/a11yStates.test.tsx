import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TxToast } from '../components/tx/TxToast';
import { GatedButton, RiskBadge, StateChip } from '../components/ui';
import { describeWriteError } from '../lib/preparedTx';
import { adminGate } from '../lib/recommendations';
import type { TxToastItem } from '../lib/txTracker';

const html = (el: JSX.Element) => renderToStaticMarkup(el);
const toast = (status: TxToastItem['status'], extra: Partial<TxToastItem> = {}): TxToastItem =>
  ({ id: 't1', title: 'Invest', status, updatedAt: 0, ...extra }) as TxToastItem;

describe('admin gate reasons (docs/08 §8)', () => {
  it('walks connect → ADMIN → SIWE with a reason that fits every admin control', () => {
    expect(adminGate({ isConnected: false, isAdmin: false, isSignedIn: false }).reason).toBe('Connect wallet to manage');
    expect(adminGate({ isConnected: true, isAdmin: false, isSignedIn: true }).reason).toBe('Requires ADMIN role');
    const siwe = adminGate({ isConnected: true, isAdmin: true, isSignedIn: false });
    expect(siwe).toEqual({ enabled: false, reason: 'Sign in (SIWE) to manage' });
    expect(adminGate({ isConnected: true, isAdmin: true, isSignedIn: true })).toEqual({ enabled: true, reason: null });
  });

  it('GatedButton keeps the caller aria-describedby when the gate is open', () => {
    const out = html(
      <GatedButton gate={{ enabled: true, reason: null }} aria-describedby="hint">
        Save
      </GatedButton>,
    );
    expect(out).toContain('aria-describedby="hint"');
  });

  it('GatedButton falls back to "Requires ADMIN role" when a closed gate has no reason', () => {
    expect(html(<GatedButton gate={{ enabled: false, reason: null }}>Save</GatedButton>)).toContain('title="Requires ADMIN role"');
  });
});

describe('risk badge sizes and unknown states', () => {
  it('lg badge is larger but still icon + text', () => {
    const out = html(<RiskBadge level="CRITICAL" size="lg" />);
    expect(out).toContain('text-sm');
    expect(out).toContain('✕');
    expect(out).toContain('CRITICAL');
  });

  it('unknown states fall back to a neutral chip that still shows text', () => {
    const out = html(<StateChip state="SOMETHING_NEW" />);
    expect(out).toContain('SOMETHING NEW'); // underscores become spaces
    expect(out).not.toContain('data-risk');
  });
});

describe('TxToast states (pending / confirming / success / error)', () => {
  it('pending and confirmed toasts are polite (no role=alert), with a status badge', () => {
    for (const s of ['PENDING', 'CONFIRMED'] as const) {
      const out = html(<TxToast item={toast(s, { message: 'Waiting for confirmation…' })} onDismiss={() => undefined} />);
      expect(out).not.toContain('role="alert"');
      expect(out).toContain(s === 'PENDING' ? 'Pending' : 'Confirmed');
    }
  });

  it('reverted / failed toasts interrupt with role=alert and show the stage-labelled message', () => {
    const out = html(<TxToast item={toast('FAILED', { message: 'Wallet / wallet RPC: User rejected' })} onDismiss={() => undefined} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain('Wallet / wallet RPC: User rejected');
  });

  it('confirmed toast with a hash links to Snowtrace; dismiss button has an accessible name', () => {
    const out = html(<TxToast item={toast('CONFIRMED', { hash: `0x${'a'.repeat(64)}` as `0x${string}` })} onDismiss={() => undefined} />);
    expect(out).toContain('View on Snowtrace');
    expect(out).toContain('aria-label="Dismiss Invest notification"');
  });
});

describe('wallet errors shown in the UI are redacted', () => {
  it('drops the path (API key) of RPC URLs from switch-chain / sign-in errors', () => {
    const msg = describeWriteError(new Error('request to https://rpc.example.com/v2/SECRETKEY failed'));
    expect(msg).toContain('https://rpc.example.com/…');
    expect(msg).not.toContain('SECRETKEY');
  });
});
