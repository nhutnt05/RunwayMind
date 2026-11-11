// Verbatim from docs/05 §6.2 — output schema the LLM must satisfy for NL obligation parsing.
import { z } from 'zod';

export const RecurrenceSchema = z.object({
  type: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'EVERY_N_DAYS']),
  everyNDays: z.number().int().min(1).max(365).nullable(), // required when EVERY_N_DAYS
  occurrences: z.number().int().min(2).max(1000).nullable(), // null = unlimited (recurring only)
});

export const ObligationDraftLLMSchema = z.object({
  label: z.string().min(1).max(80),
  category: z.enum(['PAYROLL', 'GRANT', 'VENDOR_INVOICE', 'OTHER']),
  recipient: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullable(), // null if not stated
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/), // decimal string as written by user
  currency: z.literal('USDC'),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // calendar date
  recurrence: RecurrenceSchema,
  sourceSpan: z.string(), // the user text fragment
});

export const NLParseLLMOutputSchema = z.object({
  obligations: z.array(ObligationDraftLLMSchema).max(10),
  needsClarification: z.array(z.string()),
});

export type Recurrence = z.infer<typeof RecurrenceSchema>;
export type ObligationDraftLLM = z.infer<typeof ObligationDraftLLMSchema>;
export type NLParseLLMOutput = z.infer<typeof NLParseLLMOutputSchema>;
