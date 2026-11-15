// Client-side filters for the Obligation Management list: category + free-text search on the label.
// Search is case- and accent-insensitive, so "luong" finds "Lương tháng 12" (Vietnamese labels are common).
import type { Category } from '@runwaymind/shared';
import type { ObligationItem } from '@/lib/api';

export type CategoryFilter = Category | 'ALL';

export interface ObligationFilters {
  category: CategoryFilter;
  /** Free text matched against the label (all words must appear, in any order). */
  query: string;
}

export const NO_FILTERS: ObligationFilters = { category: 'ALL', query: '' };

/** Lower-case, strip diacritics (NFD + combining marks; đ → d), collapse whitespace. */
export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasActiveFilters(f: ObligationFilters): boolean {
  return f.category !== 'ALL' || normalizeSearchText(f.query) !== '';
}

export function filterObligations(list: readonly ObligationItem[], f: ObligationFilters): ObligationItem[] {
  const words = normalizeSearchText(f.query).split(' ').filter(Boolean);
  return list.filter((o) => {
    if (f.category !== 'ALL' && o.category !== f.category) return false;
    if (words.length === 0) return true;
    const label = normalizeSearchText(o.metadata?.label ?? '');
    return words.every((w) => label.includes(w));
  });
}

/** "VENDOR_INVOICE" → "Vendor invoice". */
export function categoryLabel(c: Category): string {
  const s = c.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
