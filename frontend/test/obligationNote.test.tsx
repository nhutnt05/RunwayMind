// Note column: icon button only when there is a note; the popup shows the note as escaped plain text.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoteButton, ObligationNoteDialog, obligationNote } from '../components/obligations/ObligationNote';
import type { ObligationItem } from '../lib/api';

const base: ObligationItem = {
  id: '4',
  recipient: '0x00000000000000000000000000000000000000A1',
  amount: '1234000000',
  nextDueDate: 1_794_000_000,
  interval: 0,
  maxOccurrences: 1,
  paidOccurrences: 0,
  category: 'VENDOR_INVOICE',
  status: 'ACTIVE',
  withdrawalDeadline: 1_794_000_000 - 14 * 86_400,
  derivedState: 'SCHEDULED',
  metadata: { label: 'Hosting', notes: 'Invoice INV-42\nPay to <b>Acme</b>', source: 'FORM' },
};
const noop = () => undefined;

describe('obligation note', () => {
  it('treats missing and blank notes as no note', () => {
    expect(obligationNote(base)).toBe('Invoice INV-42\nPay to <b>Acme</b>');
    expect(obligationNote({ ...base, metadata: null })).toBeNull();
    expect(obligationNote({ ...base, metadata: { ...base.metadata!, notes: '   ' } })).toBeNull();
  });

  it('renders an accessible icon button when there is a note, "—" otherwise', () => {
    const withNote = renderToStaticMarkup(<NoteButton o={base} onOpen={noop} />);
    expect(withNote).toContain('aria-label="View note for Hosting"');
    expect(withNote).toContain('aria-haspopup="dialog"');
    const without = renderToStaticMarkup(<NoteButton o={{ ...base, metadata: null }} onOpen={noop} />);
    expect(without).toContain('aria-label="No note"');
    expect(without).not.toContain('<button');
  });

  it('popup shows the note escaped (no HTML injection), with the obligation name', () => {
    const html = renderToStaticMarkup(<ObligationNoteDialog obligation={base} onClose={noop} />);
    expect(html).toContain('Hosting');
    expect(html).toContain('#4');
    expect(html).toContain('Pay to &lt;b&gt;Acme&lt;/b&gt;');
    expect(html).not.toContain('<b>Acme</b>');
    expect(html).toContain('whitespace-pre-wrap');
  });

  it('renders nothing inside the dialog when closed', () => {
    expect(renderToStaticMarkup(<ObligationNoteDialog obligation={null} onClose={noop} />)).not.toContain('Note');
  });
});
