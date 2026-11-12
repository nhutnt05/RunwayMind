import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoModeBannerView, DemoModeIndicator } from '../components/layout/DemoModeBadge';
import {
  AdminGateNotice,
  EmptyState,
  ErrorState,
  GatedButton,
  RiskBadge,
  SkeletonCard,
  SkeletonGrid,
  StaleDataNotice,
  StateChip,
} from '../components/ui';
import { RISK_STYLE, type RiskLevel } from '../components/ui/RiskBadge';
import { adminGate } from '../lib/recommendations';

const ADMIN = adminGate({ isConnected: true, isAdmin: true, isSignedIn: true });
const VIEWER = adminGate({ isConnected: true, isAdmin: false, isSignedIn: true });
const DISCONNECTED = adminGate({ isConnected: false, isAdmin: false, isSignedIn: false });

const html = (el: JSX.Element) => renderToStaticMarkup(el);
const buttonTag = (markup: string) => markup.match(/<button[^>]*>/)?.[0] ?? '';

describe('RiskBadge — color + icon + text (docs/08 §9)', () => {
  const levels: RiskLevel[] = ['SAFE', 'HEALTHY', 'WATCH', 'CRITICAL'];

  it.each(levels)('%s renders its text, an aria-hidden icon and a data-risk hook', (level) => {
    const out = html(<RiskBadge level={level} />);
    expect(out).toContain(`data-risk="${level}"`);
    expect(out).toContain(`>${level}</span>`);
    expect(out).toContain(`<span aria-hidden="true">${RISK_STYLE[level].icon}</span>`);
  });

  it('SAFE, WATCH and CRITICAL use distinct icons and distinct colors', () => {
    const icons = new Set(['SAFE', 'WATCH', 'CRITICAL'].map((l) => RISK_STYLE[l as RiskLevel].icon));
    const badges = new Set(['SAFE', 'WATCH', 'CRITICAL'].map((l) => RISK_STYLE[l as RiskLevel].badge));
    expect(icons.size).toBe(3);
    expect(badges.size).toBe(3);
  });

  it('uses AA-safe dark text shades (≥ 800 on 100 backgrounds), never the 500/600 mid tones', () => {
    for (const l of levels) {
      expect(RISK_STYLE[l].badge).toMatch(/text-\w+-900/);
      expect(RISK_STYLE[l].text).toMatch(/text-\w+-800/);
    }
  });

  it('StateChip routes risk classes through RiskBadge so they look the same everywhere', () => {
    for (const l of levels) expect(html(<StateChip state={l} />)).toContain(`data-risk="${l}"`);
    expect(html(<StateChip state="OVERDUE" />)).not.toContain('data-risk');
    // An explicit tone keeps the generic chip.
    expect(html(<StateChip state="WATCH" tone="info" />)).not.toContain('data-risk');
  });
});

describe('GatedButton — disabled admin controls with tooltip (docs/08 §8)', () => {
  it('non-ADMIN: disabled, native title, described by a role="tooltip" element with the reason', () => {
    const out = html(<GatedButton gate={VIEWER}>Invest</GatedButton>);
    const tag = buttonTag(out);
    expect(tag).toMatch(/disabled=""/);
    expect(tag).toContain('title="Requires ADMIN role"');
    const describedBy = tag.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(out).toMatch(new RegExp(`<span id="${describedBy}" role="tooltip"[^>]*>.*Requires ADMIN role</span>`));
    // The wrapper also carries the title: disabled buttons do not receive hover in every browser.
    expect(out).toMatch(/^<span class="group[^"]*" title="Requires ADMIN role">/);
  });

  it('wallet not connected: reason is "Connect wallet to manage"', () => {
    const tag = buttonTag(html(<GatedButton gate={DISCONNECTED}>Approve</GatedButton>));
    expect(tag).toContain('title="Connect wallet to manage"');
    expect(tag).toMatch(/disabled=""/);
  });

  it('ADMIN: enabled, no tooltip, no gate title', () => {
    const out = html(<GatedButton gate={ADMIN}>Invest</GatedButton>);
    expect(buttonTag(out)).not.toMatch(/disabled=""/);
    expect(out).not.toContain('role="tooltip"');
    expect(out).not.toContain('title=');
  });

  it('ADMIN but busy: the caller-provided disabled still applies', () => {
    expect(buttonTag(html(<GatedButton gate={ADMIN} disabled>Saving…</GatedButton>))).toMatch(/disabled=""/);
  });

  it('defaults to type="button" but honours type="submit"', () => {
    expect(buttonTag(html(<GatedButton gate={ADMIN}>A</GatedButton>))).toContain('type="button"');
    expect(buttonTag(html(<GatedButton gate={ADMIN} type="submit">A</GatedButton>))).toContain('type="submit"');
  });

  it('keeps the accessible name (aria-label / text) of the wrapped button', () => {
    const tag = buttonTag(html(<GatedButton gate={VIEWER} aria-label="Remove inflow Grant">Remove</GatedButton>));
    expect(tag).toContain('aria-label="Remove inflow Grant"');
  });
});

describe('AdminGateNotice', () => {
  it('shows the gate reason as visible text for keyboard / screen-reader users', () => {
    const out = html(<AdminGateNotice gate={VIEWER} context="Settings are read-only." />);
    expect(out).toContain('role="note"');
    expect(out).toContain('Requires ADMIN role');
    expect(out).toContain('Settings are read-only.');
  });

  it('renders nothing for ADMIN', () => {
    expect(html(<AdminGateNotice gate={ADMIN} />)).toBe('');
  });
});

describe('loading, empty and error states (docs/08 §8)', () => {
  it('SkeletonCard is announced once as a loading status and draws the card frame', () => {
    const out = html(<SkeletonCard label="runway" lines={3} />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('Loading runway…');
    expect(out).toContain('rounded-xl border');
    expect(out.match(/animate-pulse/g)).toHaveLength(4); // title bar + 3 lines
  });

  it('SkeletonGrid renders N aria-hidden card placeholders and one status message', () => {
    const out = html(<SkeletonGrid label="adapters" count={2} />);
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).toContain('Loading adapters…');
    expect(out.match(/<div aria-hidden="true" class="rounded-xl/g)).toHaveLength(2);
  });

  it('EmptyState renders a call to action link', () => {
    const out = html(<EmptyState title="No obligations yet" action={{ label: 'Add obligation', href: '/obligations' }} />);
    expect(out).toContain('No obligations yet');
    expect(out).toContain('href="/obligations"');
    expect(out).toContain('Add obligation');
  });

  it('ErrorState is an alert with Retry and last-updated time', () => {
    const out = html(<ErrorState title="Could not load" message="500" onRetry={() => undefined} lastUpdated="10:00:00" />);
    expect(out).toContain('role="alert"');
    expect(out).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(out).toContain('Last updated 10:00:00');
  });

  it('StaleDataNotice keeps stale data on screen with the last updated timestamp', () => {
    const out = html(<StaleDataNotice lastUpdated="10:00:00" onRetry={() => undefined} />);
    expect(out).toContain('role="status"');
    expect(out).toContain('last updated 10:00:00');
    expect(out).toMatch(/<button[^>]*>Retry<\/button>/);
  });
});

describe('DEMO MODE banner and Day N badge (video visibility)', () => {
  it('badge shows DEMO MODE and the Day N chip in large, high-contrast type', () => {
    const out = html(<DemoModeIndicator day={12} />);
    expect(out).toContain('DEMO MODE');
    expect(out).toContain('>Day 12<');
    expect(out).toContain('text-slate-950');
    expect(out).toContain('bg-amber-400');
    expect(out).toContain('text-sm');
  });

  it('badge omits the day when demoStartTime is unknown', () => {
    expect(html(<DemoModeIndicator day={null} />)).not.toContain('Day');
  });

  it('banner is a labelled status strip with the day and a not-in-production note', () => {
    const out = html(<DemoModeBannerView day={3} />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-label="Demo mode, day 3"');
    expect(out).toContain('>Day 3<');
    expect(out).toContain('not available in production');
  });
});
