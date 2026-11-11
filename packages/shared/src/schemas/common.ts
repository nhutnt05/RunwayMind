// Shared validation primitives (docs/09 §6).
import { getAddress } from 'viem';
import { z } from 'zod';
import type { Address } from '../types/ladder';

export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const MAX_AMOUNT = 10n ** 15n; // 1e9 USDC sanity cap (base units)
export const MIN_INTERVAL_SEC = 86_400; // 1 day
export const MAX_INTERVAL_SEC = 31_536_000; // 365 days
export const LABEL_MAX = 80;
export const NOTES_MAX = 500;
export const NL_TEXT_MAX = 2_000;

/** Address: regex, then EIP-55 checksum via `getAddress()`. Output is the checksummed address. */
export const AddressSchema = z
  .string()
  .regex(ADDRESS_REGEX, 'invalid address')
  .transform((value) => getAddress(value) as Address);

const INTEGER_STRING = /^\d+$/;

/** Amount in base units as a decimal string: `/^\d+$/`, > 0, ≤ 10^15. */
export const AmountStringSchema = z.string().superRefine((value, ctx) => {
  // zod 3 keeps running refinements after a failed check, so the regex is tested here before BigInt().
  if (!INTEGER_STRING.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be an integer string of base units' });
    return;
  }
  const amount = BigInt(value);
  if (amount <= 0n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount must be > 0' });
  else if (amount > MAX_AMOUNT) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount exceeds sanity cap 10^15' });
});

export const UnixSecondsSchema = z.number().int().nonnegative();

export const CategorySchema = z.enum(['PAYROLL', 'GRANT', 'VENDOR_INVOICE', 'OTHER']);
export const ObligationSourceSchema = z.enum(['FORM', 'NL', 'SEED']);
export const AdapterStatusSchema = z.enum(['NONE', 'ACTIVE', 'WITHDRAW_ONLY']);

export const IntervalSchema = z
  .number()
  .int()
  .refine((v) => v === 0 || (v >= MIN_INTERVAL_SEC && v <= MAX_INTERVAL_SEC), {
    message: `interval must be 0 or within [${MIN_INTERVAL_SEC}, ${MAX_INTERVAL_SEC}]`,
  });

/** Registry V6 (docs/02 §B.4): one-time ⇒ maxOccurrences == 1; recurring ⇒ 0 (unlimited) or ≥ 2. */
export function isValidOccurrences(interval: number, maxOccurrences: number): boolean {
  if (interval === 0) return maxOccurrences === 1;
  return maxOccurrences === 0 || maxOccurrences >= 2;
}

export const LabelSchema = z.string().trim().min(1).max(LABEL_MAX);
export const NotesSchema = z.string().max(NOTES_MAX).nullable();
export const TxHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'invalid transaction hash');
