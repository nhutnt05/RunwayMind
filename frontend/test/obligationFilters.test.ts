// Obligation Management filters: category + label search (case- and Vietnamese-accent-insensitive).
import { describe, expect, it } from 'vitest';
import type { ObligationItem } from '../lib/api';
import { NO_FILTERS, categoryLabel, filterObligations, hasActiveFilters, normalizeSearchText } from '../lib/obligationFilters';

const ob = (id: string, label: string | null, category: ObligationItem['category']): ObligationItem => ({
  id,
  recipient: '0x00000000000000000000000000000000000000A1',
  amount: '1000000',
  nextDueDate: 1_794_000_000,
  interval: 0,
  maxOccurrences: 1,
  paidOccurrences: 0,
  category,
  status: 'ACTIVE',
  withdrawalDeadline: 1_793_000_000,
  derivedState: 'SCHEDULED',
  metadata: label === null ? null : { label, notes: null, source: 'FORM' },
});

const LIST = [
  ob('1', 'Lương tháng 12', 'PAYROLL'),
  ob('2', 'December payroll', 'PAYROLL'),
  ob('3', 'Q1 grant', 'GRANT'),
  ob('4', 'Đối tác hosting', 'VENDOR_INVOICE'),
  ob('5', null, 'OTHER'),
];
const ids = (l: ObligationItem[]) => l.map((o) => o.id);

describe('obligation filters', () => {
  it('no filters → everything', () => {
    expect(ids(filterObligations(LIST, NO_FILTERS))).toEqual(['1', '2', '3', '4', '5']);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ category: 'ALL', query: '   ' })).toBe(false);
  });

  it('category only', () => {
    expect(ids(filterObligations(LIST, { category: 'PAYROLL', query: '' }))).toEqual(['1', '2']);
    expect(ids(filterObligations(LIST, { category: 'GRANT', query: '' }))).toEqual(['3']);
  });

  it('label search ignores case, accents and đ; all words must match in any order', () => {
    expect(ids(filterObligations(LIST, { category: 'ALL', query: 'luong' }))).toEqual(['1']);
    expect(ids(filterObligations(LIST, { category: 'ALL', query: 'THÁNG 12' }))).toEqual(['1']);
    expect(ids(filterObligations(LIST, { category: 'ALL', query: 'doi tac' }))).toEqual(['4']);
    expect(ids(filterObligations(LIST, { category: 'ALL', query: 'payroll december' }))).toEqual(['2']);
    expect(ids(filterObligations(LIST, { category: 'ALL', query: 'zzz' }))).toEqual([]);
  });

  it('category and search combine', () => {
    expect(ids(filterObligations(LIST, { category: 'GRANT', query: 'payroll' }))).toEqual([]);
    expect(ids(filterObligations(LIST, { category: 'PAYROLL', query: '12' }))).toEqual(['1']);
  });

  it('obligations without a label only match an empty search', () => {
    expect(ids(filterObligations(LIST, { category: 'OTHER', query: '' }))).toEqual(['5']);
    expect(ids(filterObligations(LIST, { category: 'OTHER', query: 'x' }))).toEqual([]);
  });

  it('helpers', () => {
    expect(normalizeSearchText('  Lương   Tháng 12 ')).toBe('luong thang 12');
    expect(categoryLabel('VENDOR_INVOICE')).toBe('Vendor invoice');
  });
});
