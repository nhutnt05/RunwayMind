// CreateObligationForm model (docs/08 §3.3): UI-shaped form values → `POST /obligations` body (docs/07 §5.1).
// Validation of the request itself is delegated to the shared `CreateObligationRequestSchema` so the form and the
// backend apply the same rules (registry V2–V6). Amounts are parsed to bigint base units with `parseUsdc` and the
// due date is stored as 00:00:00 UTC of the chosen calendar date (A-06) via `toUtcMidnight`.
import { z } from 'zod';
import {
  CategorySchema,
  CreateObligationRequestSchema,
  UpdateObligationRequestSchema,
  formatUsdcPlain,
  parseUsdc,
  toIsoDateUtc,
  toUtcMidnight,
  type CreateObligationRequest,
} from '@runwaymind/shared';

export const SECONDS_PER_DAY = 86_400;
export const WEEKLY_INTERVAL_SEC = 7 * SECONDS_PER_DAY;
/** "Monthly" is approximated as a fixed 30-day interval (docs/08 §3.3, warning MONTHLY_APPROXIMATED_30_DAYS). */
export const MONTHLY_INTERVAL_SEC = 30 * SECONDS_PER_DAY;

export const RECURRENCE_OPTIONS = [
  { value: 'NONE', label: 'None (one-time)' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY_30D', label: 'Monthly (30 d)' },
  { value: 'EVERY_N_DAYS', label: 'Every N days' },
] as const;

export const RecurrenceSchema = z.enum(['NONE', 'WEEKLY', 'MONTHLY_30D', 'EVERY_N_DAYS']);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

/** Raw form values: every text input stays a string so no number/float ever touches the amount. */
export const ObligationFormBaseSchema = z.object({
  label: z.string(),
  notes: z.string(),
  category: CategorySchema,
  recipient: z.string(),
  amount: z.string(),
  firstDueDate: z.string(), // YYYY-MM-DD from <input type="date">
  recurrence: RecurrenceSchema,
  everyNDays: z.string(),
  occurrences: z.string(), // '' or '0' = unlimited (recurring only)
});
export type ObligationFormValues = z.infer<typeof ObligationFormBaseSchema>;

export const DEFAULT_OBLIGATION_FORM: ObligationFormValues = {
  label: '',
  notes: '',
  category: 'PAYROLL',
  recipient: '',
  amount: '',
  firstDueDate: '',
  recurrence: 'NONE',
  everyNDays: '',
  occurrences: '',
};

export class ObligationFormError extends Error {
  constructor(
    readonly field: keyof ObligationFormValues,
    message: string,
  ) {
    super(message);
    this.name = 'ObligationFormError';
  }
}

const INTEGER = /^\d+$/;

/** Interval in seconds for the chosen recurrence. */
export function recurrenceToInterval(recurrence: Recurrence, everyNDays: string): number {
  switch (recurrence) {
    case 'NONE':
      return 0;
    case 'WEEKLY':
      return WEEKLY_INTERVAL_SEC;
    case 'MONTHLY_30D':
      return MONTHLY_INTERVAL_SEC;
    case 'EVERY_N_DAYS': {
      const n = everyNDays.trim();
      if (!INTEGER.test(n) || Number(n) < 1 || Number(n) > 365) {
        throw new ObligationFormError('everyNDays', 'Enter a whole number of days between 1 and 365');
      }
      return Number(n) * SECONDS_PER_DAY;
    }
  }
}

/** maxOccurrences: one-time ⇒ 1; recurring ⇒ blank/0 = unlimited (0), otherwise the entered count. */
export function occurrencesToMax(recurrence: Recurrence, occurrences: string): number {
  if (recurrence === 'NONE') return 1;
  const v = occurrences.trim();
  if (v === '') return 0;
  if (!INTEGER.test(v)) throw new ObligationFormError('occurrences', 'Enter a whole number (blank = unlimited)');
  return Number(v);
}

/**
 * Converts form values to the `POST /obligations` request (unvalidated input shape). Throws `ObligationFormError`
 * for fields that cannot be converted at all (bad amount / date / N days / occurrences).
 */
export function toCreateObligationRequest(values: ObligationFormValues): z.input<typeof CreateObligationRequestSchema> {
  let amount: bigint;
  try {
    amount = parseUsdc(values.amount);
  } catch {
    throw new ObligationFormError('amount', 'Enter an amount like 20000 or 20,000.50 (max 6 decimals)');
  }
  let firstDueDate: number;
  try {
    firstDueDate = toUtcMidnight(values.firstDueDate);
  } catch {
    throw new ObligationFormError('firstDueDate', 'Pick a valid date');
  }
  return {
    label: values.label.trim(),
    notes: values.notes.trim() === '' ? null : values.notes.trim(),
    category: values.category,
    recipient: values.recipient.trim(),
    amount: amount.toString(),
    firstDueDate,
    interval: recurrenceToInterval(values.recurrence, values.everyNDays),
    maxOccurrences: occurrencesToMax(values.recurrence, values.occurrences),
    source: 'FORM',
    nlDraftId: null,
  };
}

const REQUEST_FIELD_TO_FORM: Record<string, keyof ObligationFormValues> = {
  label: 'label',
  notes: 'notes',
  category: 'category',
  recipient: 'recipient',
  amount: 'amount',
  firstDueDate: 'firstDueDate',
  interval: 'everyNDays',
  maxOccurrences: 'occurrences',
};

/**
 * Form schema for react-hook-form: converts the values and validates them with the shared request schema, mapping
 * request-level issues back onto form fields. `chainTime` (Treasury.currentTime) enforces `firstDueDate > chainTime`
 * client-side as well (the backend checks it again).
 */
export function createObligationFormSchema(opts: { chainTime?: number | null } = {}) {
  return ObligationFormBaseSchema.superRefine((values, ctx) => {
    let request: z.input<typeof CreateObligationRequestSchema>;
    try {
      request = toCreateObligationRequest(values);
    } catch (e) {
      if (e instanceof ObligationFormError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [e.field], message: e.message });
        return;
      }
      throw e;
    }
    const parsed = CreateObligationRequestSchema.safeParse(request);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = REQUEST_FIELD_TO_FORM[String(issue.path[0])] ?? 'label';
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: issue.message });
      }
    }
    if (opts.chainTime && request.firstDueDate <= opts.chainTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstDueDate'],
        message: 'First due date must be after the current chain time',
      });
    }
  });
}

/** Final, validated request body (recipient checksummed by the shared AddressSchema). */
export function buildCreateObligationRequest(values: ObligationFormValues): CreateObligationRequest {
  return CreateObligationRequestSchema.parse(toCreateObligationRequest(values));
}

/** Human label for an on-chain interval (seconds). */
export function intervalLabel(interval: number): string {
  if (interval === 0) return 'One-time';
  if (interval === WEEKLY_INTERVAL_SEC) return 'Weekly';
  if (interval === MONTHLY_INTERVAL_SEC) return 'Monthly (30 d)';
  if (interval % SECONDS_PER_DAY === 0) return `Every ${interval / SECONDS_PER_DAY} days`;
  return `Every ${interval} s`;
}

// ---- PATCH /obligations/:id (docs/07 §5.2) -----------------------------------------------------------------------

export interface ObligationEditValues {
  recipient: string;
  amount: string; // decimal USDC, e.g. "20,000.00"
  nextDueDate: string; // YYYY-MM-DD
  label: string;
  notes: string;
}

export interface ObligationEditOriginal {
  recipient: string;
  amount: string; // base units
  nextDueDate: number;
  label: string | null;
  notes: string | null;
}

export function toEditValues(o: ObligationEditOriginal): ObligationEditValues {
  return {
    recipient: o.recipient,
    amount: formatUsdcPlain(BigInt(o.amount)),
    nextDueDate: toIsoDateUtc(o.nextDueDate),
    label: o.label ?? '',
    notes: o.notes ?? '',
  };
}

/**
 * Only changed fields are sent: on-chain fields (recipient, amount, nextDueDate) produce a prepared
 * `updateObligation` tx, label/notes-only changes are applied off-chain (docs/07 §5.2). Throws
 * `ObligationFormError` on unparsable input; the result is validated with the shared schema by the API client.
 */
export function buildUpdateObligationRequest(
  original: ObligationEditOriginal,
  values: ObligationEditValues,
): z.input<typeof UpdateObligationRequestSchema> {
  const body: z.input<typeof UpdateObligationRequestSchema> = {};
  if (values.recipient.trim().toLowerCase() !== original.recipient.toLowerCase()) body.recipient = values.recipient.trim();
  let amount: bigint;
  try {
    amount = parseUsdc(values.amount);
  } catch {
    throw new ObligationFormError('amount', 'Enter an amount like 20000 or 20,000.50 (max 6 decimals)');
  }
  if (amount !== BigInt(original.amount)) body.amount = amount.toString();
  let due: number;
  try {
    due = toUtcMidnight(values.nextDueDate);
  } catch {
    throw new ObligationFormError('firstDueDate', 'Pick a valid date');
  }
  if (due !== original.nextDueDate) body.nextDueDate = due;
  if (values.label.trim() !== (original.label ?? '')) body.label = values.label.trim();
  const notes = values.notes.trim() === '' ? null : values.notes.trim();
  if (notes !== (original.notes ?? null)) body.notes = notes;
  return body;
}
