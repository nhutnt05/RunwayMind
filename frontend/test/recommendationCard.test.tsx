import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecommendationCard } from '../components/recommendations/RecommendationCard';
import type { AgentDecisionJson } from '../lib/api';
import {
  adminGate,
  decisionHeadline,
  decisionTxStatus,
  expiryLabel,
  isActionable,
  isTerminalDecision,
} from '../lib/recommendations';

const T = 1_793_318_400;
const ADAPTER = '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD';
const HASH = `0x${'ab'.repeat(32)}` as const;

function decision(overrides: Partial<AgentDecisionJson> = {}): AgentDecisionJson {
  return {
    id: 'dec_1',
    action: 'INVEST',
    adapter: ADAPTER,
    amount: '70000000000',
    reasonCode: 'IDLE_SURPLUS',
    status: 'PENDING_APPROVAL',
    mode: 'APPROVE',
    explanation: {
      headline: 'Invest 70000.00 USDC into Mock Lending Pool',
      explanation: 'Idle exceeds the required reserve.',
      reasons: ['Idle 100000.00 > required 30000.00', 'APY 8.00%'],
      riskNote: null,
      source: 'LLM',
    },
    facts: {},
    snapshotId: 'snap_1',
    createdAt: T,
    expiresAt: T + 600,
    actions: [],
    ...overrides,
  };
}

const ADMIN = adminGate({ isConnected: true, isAdmin: true, isSignedIn: true });
const VIEWER = adminGate({ isConnected: true, isAdmin: false, isSignedIn: true });

function buttons(html: string) {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => ({ tag: m[0], label: m[1] }));
}

describe('adminGate (docs/08 §8)', () => {
  it('requires a connected wallet, ADMIN role and a SIWE session', () => {
    expect(adminGate({ isConnected: false, isAdmin: true, isSignedIn: true })).toEqual({
      enabled: false,
      reason: 'Connect wallet to manage',
    });
    expect(VIEWER).toEqual({ enabled: false, reason: 'Requires ADMIN role' });
    expect(adminGate({ isConnected: true, isAdmin: true, isSignedIn: false }).enabled).toBe(false);
    expect(ADMIN).toEqual({ enabled: true, reason: null });
  });
});

describe('RecommendationCard role gating', () => {
  it('renders headline, explanation, reasons, amount and expiry', () => {
    const html = renderToStaticMarkup(<RecommendationCard decision={decision()} nowSec={T} gate={ADMIN} />);
    expect(html).toContain('Invest 70000.00 USDC into Mock Lending Pool');
    expect(html).toContain('Idle exceeds the required reserve.');
    expect(html).toContain('APY 8.00%');
    expect(html).toContain('70,000.00');
    expect(html).toContain('expires in 10m 00s');
    expect(html).toContain('AI explanation');
  });

  it('ADMIN: Approve and Reject are enabled', () => {
    const html = renderToStaticMarkup(<RecommendationCard decision={decision()} nowSec={T} gate={ADMIN} />);
    const b = buttons(html).filter((x) => x.label === 'Approve' || x.label === 'Reject');
    expect(b).toHaveLength(2);
    for (const x of b) expect(x.tag).not.toMatch(/disabled=""/);
  });

  it('non-ADMIN: buttons are disabled with tooltip "Requires ADMIN role"', () => {
    const html = renderToStaticMarkup(<RecommendationCard decision={decision()} nowSec={T} gate={VIEWER} />);
    const b = buttons(html).filter((x) => x.label === 'Approve' || x.label === 'Reject');
    expect(b).toHaveLength(2);
    for (const x of b) {
      expect(x.tag).toMatch(/disabled=""/);
      expect(x.tag).toContain('title="Requires ADMIN role"');
      expect(x.tag).toMatch(/aria-describedby="[^"]+"/);
    }
    // Styled hover tooltip + visible reason next to the buttons (keyboard users cannot focus disabled buttons).
    expect(html).toMatch(/role="tooltip"[^>]*>.*Requires ADMIN role<\/span>/);
    expect(html).toMatch(/text-xs text-slate-700">.*Requires ADMIN role<\/span>/);
  });

  it('busy state disables buttons even for ADMIN', () => {
    const html = renderToStaticMarkup(
      <RecommendationCard decision={decision()} nowSec={T} gate={ADMIN} busy="approve" />,
    );
    expect(buttons(html).find((x) => x.label === 'Approving…')?.tag).toMatch(/disabled=""/);
  });

  it('no Approve/Reject once expired or no longer pending', () => {
    for (const d of [decision({ expiresAt: T }), decision({ status: 'APPROVED' }), decision({ status: 'EXECUTED' })]) {
      const html = renderToStaticMarkup(<RecommendationCard decision={d} nowSec={T} gate={ADMIN} />);
      expect(buttons(html).some((x) => x.label === 'Approve')).toBe(false);
    }
  });

  it('EXECUTED shows the Snowtrace link; BLOCKED_BY_POLICY turns red with the decoded rule', () => {
    const executed = renderToStaticMarkup(
      <RecommendationCard
        decision={decision({
          status: 'EXECUTED',
          actions: [{ id: 'a1', functionName: 'invest', status: 'CONFIRMED', txHash: HASH, decodedError: null }],
        })}
        nowSec={T}
        gate={ADMIN}
      />,
    );
    expect(executed).toContain(`https://testnet.snowtrace.io/tx/${HASH}`);

    const blocked = renderToStaticMarkup(
      <RecommendationCard
        decision={decision({
          status: 'BLOCKED_BY_POLICY',
          actions: [
            {
              id: 'a1',
              functionName: 'invest',
              status: 'BLOCKED_BY_POLICY',
              txHash: null,
              decodedError: { name: 'ReserveViolation', args: { idleAfter: '10000000000', requiredReserve: '30000000000' } },
            },
          ],
        })}
        nowSec={T}
        gate={ADMIN}
      />,
    );
    expect(blocked).toContain('data-status="BLOCKED_BY_POLICY"');
    expect(blocked).toContain('border-red-400');
    expect(blocked).toContain('ReserveViolation: idle after 10,000.00 &lt; required 30,000.00');
  });
});

describe('recommendation helpers', () => {
  it('polling stops only at terminal statuses', () => {
    expect(isTerminalDecision('EXECUTED')).toBe(true);
    expect(isTerminalDecision('BLOCKED_BY_POLICY')).toBe(true);
    expect(isTerminalDecision('APPROVED')).toBe(false);
    expect(isTerminalDecision('EXECUTING')).toBe(false);
  });

  it('expiryLabel / isActionable use the given wall-clock now', () => {
    expect(expiryLabel(T + 3725, T)).toBe('expires in 1h 02m');
    expect(expiryLabel(T + 45, T)).toBe('expires in 45s');
    expect(expiryLabel(T, T)).toBe('expired');
    expect(isActionable(decision(), T)).toBe(true);
    expect(isActionable(decision(), T + 600)).toBe(false);
  });

  it('headline falls back when no explanation exists', () => {
    expect(decisionHeadline(decision({ explanation: null, action: 'WITHDRAW_ALL', amount: '20000000000' }))).toBe(
      'Withdraw all 20,000.00 USDC',
    );
    expect(decisionHeadline(decision({ explanation: null, action: 'TRIP_CIRCUIT_BREAKER', amount: null }))).toBe(
      'Trip circuit breaker',
    );
  });

  it('maps decision status to toast tx status', () => {
    expect(decisionTxStatus('EXECUTED')).toBe('CONFIRMED');
    expect(decisionTxStatus('BLOCKED_BY_POLICY')).toBe('REVERTED');
    expect(decisionTxStatus('EXECUTING')).toBe('PENDING');
  });
});

describe('approval expiry is wall-clock, not chain time (CP2 B-12)', () => {
  it('a fresh card stays actionable when demo time travel moved chain time 3 days ahead', () => {
    // expiresAt = wall clock + 10 min (backend TTL). Chain time is irrelevant to it.
    const wallNow = T;
    const d = decision();
    const chainTimeAfterTravel = wallNow + 3 * 86_400;
    expect(isActionable(d, chainTimeAfterTravel)).toBe(false); // the old bug: comparing with chain time
    expect(isActionable(d, wallNow)).toBe(true); // the fix: the card passes wall-clock nowSec
    const html = renderToStaticMarkup(<RecommendationCard decision={d} nowSec={wallNow} gate={ADMIN} />);
    expect(html).toContain('Approve');
    expect(html).not.toContain('>expired<');
  });
});
