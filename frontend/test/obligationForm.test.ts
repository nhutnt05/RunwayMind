import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBLIGATION_FORM,
  MONTHLY_INTERVAL_SEC,
  WEEKLY_INTERVAL_SEC,
  buildCreateObligationRequest,
  buildUpdateObligationRequest,
  createObligationFormSchema,
  intervalLabel,
  toCreateObligationRequest,
  toEditValues,
  type ObligationFormValues,
} from '../lib/obligationForm';

const RECIPIENT_LC = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const RECIPIENT = '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD'; // EIP-55 of the above
const DEC_15_2026 = 1_797_292_800; // 2026-12-15T00:00:00Z
const DAY = 86_400;

function form(overrides: Partial<ObligationFormValues> = {}): ObligationFormValues {
  return {
    ...DEFAULT_OBLIGATION_FORM,
    label: 'December payroll',
    recipient: RECIPIENT_LC,
    amount: '20,000',
    firstDueDate: '2026-12-15',
    ...overrides,
  };
}

function fieldErrors(values: ObligationFormValues, chainTime?: number): Record<string, string> {
  const r = createObligationFormSchema({ chainTime }).safeParse(values);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe('date → UTC midnight (A-06)', () => {
  it('stores the picked calendar date as 00:00:00 UTC regardless of local time zone', () => {
    const req = toCreateObligationRequest(form());
    expect(req.firstDueDate).toBe(DEC_15_2026);
    expect(new Date(req.firstDueDate * 1000).toISOString()).toBe('2026-12-15T00:00:00.000Z');
    expect(req.firstDueDate % DAY).toBe(0);
  });

  it('rejects empty or impossible dates on the firstDueDate field', () => {
    expect(fieldErrors(form({ firstDueDate: '' }))).toHaveProperty('firstDueDate');
    expect(fieldErrors(form({ firstDueDate: '2026-02-30' }))).toHaveProperty('firstDueDate');
  });

  it('requires firstDueDate > chain time when chain time is known', () => {
    expect(fieldErrors(form(), DEC_15_2026)).toHaveProperty('firstDueDate');
    expect(fieldErrors(form(), DEC_15_2026 - 1)).toEqual({});
  });
});

describe('amount → bigint base units (decimal string)', () => {
  it('parses grouped decimal input without floating point', () => {
    expect(toCreateObligationRequest(form({ amount: '20,000' })).amount).toBe('20000000000');
    expect(toCreateObligationRequest(form({ amount: '0.000001' })).amount).toBe('1');
    expect(toCreateObligationRequest(form({ amount: '70030.68' })).amount).toBe('70030680000');
  });

  it('rejects zero, negatives, too many decimals and the 10^15 sanity cap', () => {
    for (const amount of ['0', '-5', '1.0000001', 'abc', '', '1000000000.000001']) {
      expect(fieldErrors(form({ amount })), amount).toHaveProperty('amount');
    }
  });
});

describe('recurrence → interval / maxOccurrences (registry V6)', () => {
  it('None ⇒ interval 0, maxOccurrences 1', () => {
    const r = toCreateObligationRequest(form({ recurrence: 'NONE', occurrences: '7' }));
    expect([r.interval, r.maxOccurrences]).toEqual([0, 1]);
  });

  it('Weekly / Monthly (30 d) / Every N days map to fixed seconds', () => {
    expect(toCreateObligationRequest(form({ recurrence: 'WEEKLY' })).interval).toBe(WEEKLY_INTERVAL_SEC);
    expect(toCreateObligationRequest(form({ recurrence: 'MONTHLY_30D' })).interval).toBe(30 * DAY);
    expect(MONTHLY_INTERVAL_SEC).toBe(2_592_000);
    expect(toCreateObligationRequest(form({ recurrence: 'EVERY_N_DAYS', everyNDays: '14' })).interval).toBe(14 * DAY);
  });

  it('recurring: blank = unlimited (0), 1 is rejected, ≥ 2 accepted', () => {
    expect(toCreateObligationRequest(form({ recurrence: 'WEEKLY', occurrences: '' })).maxOccurrences).toBe(0);
    expect(fieldErrors(form({ recurrence: 'WEEKLY', occurrences: '1' }))).toHaveProperty('occurrences');
    expect(fieldErrors(form({ recurrence: 'WEEKLY', occurrences: '12' }))).toEqual({});
  });

  it('Every N days must be an integer in [1, 365]', () => {
    for (const n of ['', '0', '366', '1.5', 'x']) {
      expect(fieldErrors(form({ recurrence: 'EVERY_N_DAYS', everyNDays: n })), n).toHaveProperty('everyNDays');
    }
    expect(fieldErrors(form({ recurrence: 'EVERY_N_DAYS', everyNDays: '1' }))).toEqual({});
  });
});

describe('shared schema validation', () => {
  it('maps recipient / label errors onto form fields', () => {
    const errs = fieldErrors(form({ recipient: '0x123', label: '  ' }));
    expect(errs).toHaveProperty('recipient');
    expect(errs).toHaveProperty('label');
  });

  it('builds the exact docs/07 §5.1 body with a checksummed recipient', () => {
    expect(buildCreateObligationRequest(form({ notes: '  ' }))).toEqual({
      label: 'December payroll',
      notes: null,
      category: 'PAYROLL',
      recipient: RECIPIENT,
      amount: '20000000000',
      firstDueDate: DEC_15_2026,
      interval: 0,
      maxOccurrences: 1,
      source: 'FORM',
      nlDraftId: null,
    });
  });
});

describe('PATCH body (docs/07 §5.2)', () => {
  const original = { recipient: RECIPIENT, amount: '20000000000', nextDueDate: DEC_15_2026, label: 'Payroll', notes: null };

  it('round-trips unchanged values to an empty body', () => {
    expect(buildUpdateObligationRequest(original, toEditValues(original))).toEqual({});
    expect(toEditValues(original)).toMatchObject({ amount: '20000.00', nextDueDate: '2026-12-15' });
  });

  it('sends only changed fields', () => {
    const v = { ...toEditValues(original), amount: '25,000', label: 'Payroll v2' };
    expect(buildUpdateObligationRequest(original, v)).toEqual({ amount: '25000000000', label: 'Payroll v2' });
    const d = { ...toEditValues(original), nextDueDate: '2026-12-16' };
    expect(buildUpdateObligationRequest(original, d)).toEqual({ nextDueDate: DEC_15_2026 + DAY });
  });
});

describe('intervalLabel', () => {
  it('labels known intervals', () => {
    expect(intervalLabel(0)).toBe('One-time');
    expect(intervalLabel(WEEKLY_INTERVAL_SEC)).toBe('Weekly');
    expect(intervalLabel(MONTHLY_INTERVAL_SEC)).toBe('Monthly (30 d)');
    expect(intervalLabel(14 * DAY)).toBe('Every 14 days');
  });
});
