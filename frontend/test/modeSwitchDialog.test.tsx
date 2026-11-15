// Agent mode confirmation (replaces window.confirm): content per target mode, busy state, error text.
// <dialog> children render only when open; react-dom/server renders them since `open` is a prop of our Modal.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModeSwitchDialog } from '../components/agent/ModeSwitchDialog';

const noop = () => undefined;
const render = (p: Partial<Parameters<typeof ModeSwitchDialog>[0]> = {}) =>
  renderToStaticMarkup(<ModeSwitchDialog open target="AUTO" pending={false} error={null} onConfirm={noop} onClose={noop} {...p} />);

describe('ModeSwitchDialog', () => {
  it('AUTO: explains the change, R1–R6 still enforced, no transaction; safe choice is focused first', () => {
    const out = render();
    expect(out).toContain('Switch to AUTO mode?');
    expect(out).toContain('without waiting for your approval');
    expect(out).toContain('R1–R6');
    expect(out).toContain('no blockchain transaction');
    expect(out).toMatch(/<button[^>]*data-autofocus="true"[^>]*>Stay in APPROVE<\/button>/);
    expect(out).toContain('>Switch to AUTO</button>');
    expect(out).toContain('aria-modal="true"');
  });

  it('APPROVE: wording for switching back', () => {
    const out = render({ target: 'APPROVE' });
    expect(out).toContain('Switch back to APPROVE mode?');
    expect(out).toContain('Stay in AUTO');
    expect(out).toContain('Nothing is invested or withdrawn until an ADMIN approves it.');
  });

  it('pending: buttons disabled, no close button, progress label', () => {
    const out = render({ pending: true });
    expect(out).toContain('Switching…');
    expect(out).not.toContain('aria-label="Close dialog"');
    expect(out.match(/disabled=""/g)?.length).toBe(2);
  });

  it('error is announced inside the dialog', () => {
    const out = render({ error: 'Session expired' });
    expect(out).toMatch(/role="alert"[^>]*>.*Could not change the mode\..*Session expired/);
  });
});
