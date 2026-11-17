import { describe, expect, it } from 'vitest';
import { keeperRunSummary } from '../lib/keeperRun';

const H = `0x${'a'.repeat(64)}` as const;

describe('keeperRunSummary (toast after demo "Advance time")', () => {
  it('lists what was paid and links the last tx', () => {
    expect(keeperRunSummary({ paidIds: ['1', '3'], txHashes: [H], enforced: false, errors: [] })).toEqual({ status: 'CONFIRMED', message: 'Paid #1, #3', hash: H });
  });
  it('says plainly when nothing is due', () => {
    expect(keeperRunSummary({ paidIds: [], txHashes: [], enforced: false, errors: [] })).toEqual({ status: 'CONFIRMED', message: 'Nothing is due yet at the new date.' });
  });
  it('mentions a vault pull-back and reports failures with the decoded error', () => {
    const r = keeperRunSummary({ paidIds: [], txHashes: [H], enforced: true, errors: [{ step: 'pay', obligationId: '2', error: { name: 'InsufficientLiquidity' } }] });
    expect(r.status).toBe('FAILED');
    expect(r.message).toBe('pulled funds back from the vault. Could not finish: #2: InsufficientLiquidity');
  });
});
