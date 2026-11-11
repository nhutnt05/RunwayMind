// Request body schemas for the write endpoints of docs/07 §5 (plus the other documented request bodies in §3–§4).
// Amounts stay decimal strings of base units at the API boundary (docs/07 §2.2); services convert with BigInt().
import { z } from 'zod';
import {
  AddressSchema,
  AdapterStatusSchema,
  AmountStringSchema,
  CategorySchema,
  IntervalSchema,
  LabelSchema,
  NL_TEXT_MAX,
  NotesSchema,
  ObligationSourceSchema,
  TxHashSchema,
  UnixSecondsSchema,
  isValidOccurrences,
} from './common';

// ---- §5.1 POST /obligations (create) --------------------------------------------------------------------------
// Mirrors registry V2–V6 (docs/02 §B.4). V2's "recipient != treasury" and "firstDueDate > chainTime" need chain
// context and are checked in the service layer.
export const CreateObligationRequestSchema = z
  .object({
    label: LabelSchema,
    notes: NotesSchema.default(null),
    category: CategorySchema,
    recipient: AddressSchema,
    amount: AmountStringSchema,
    firstDueDate: UnixSecondsSchema.positive(),
    interval: IntervalSchema,
    maxOccurrences: z.number().int().min(0).max(4_294_967_295), // uint32
    source: ObligationSourceSchema.default('FORM'),
    nlDraftId: z.string().min(1).nullable().default(null),
  })
  .refine((b) => isValidOccurrences(b.interval, b.maxOccurrences), {
    message: 'one-time requires maxOccurrences = 1; recurring requires 0 (unlimited) or >= 2',
    path: ['maxOccurrences'],
  });

// ---- §5.2 PATCH /obligations/:id ------------------------------------------------------------------------------
export const UpdateObligationRequestSchema = z
  .object({
    recipient: AddressSchema.optional(),
    amount: AmountStringSchema.optional(),
    nextDueDate: UnixSecondsSchema.positive().optional(),
    label: LabelSchema.optional(),
    notes: NotesSchema.optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'at least one field is required' });

// ---- §5.4 POST /obligations/parse -----------------------------------------------------------------------------
export const ParseObligationsRequestSchema = z.object({
  text: z.string().trim().min(1).max(NL_TEXT_MAX),
  locale: z.enum(['vi', 'en']),
});

// ---- §5.5 POST /vault/withdrawals -----------------------------------------------------------------------------
export const ExecuteViaSchema = z.enum(['AGENT', 'ADMIN_WALLET']);

export const VaultWithdrawalRequestSchema = z.object({
  adapter: AddressSchema,
  amount: z.union([AmountStringSchema, z.literal('MAX')]),
  executeVia: ExecuteViaSchema.default('AGENT'),
});

// ---- §5.6 POST /vault/investments ("same shape as 5.5"; Treasury.invest has no MAX sentinel) ------------------
export const VaultInvestmentRequestSchema = z.object({
  adapter: AddressSchema,
  amount: AmountStringSchema,
  executeVia: ExecuteViaSchema.default('AGENT'),
});

// ---- §5.7 policy & demo helpers -------------------------------------------------------------------------------
const PreparedArgSchema = z.union([z.string(), z.number(), z.boolean()]);

export const PolicyPrepareRequestSchema = z.discriminatedUnion('fn', [
  z.object({ fn: z.literal('setSafetyHorizon'), args: z.tuple([z.number().int().positive()]) }),
  z.object({ fn: z.literal('setEmergencyBuffer'), args: z.tuple([z.string().regex(/^\d+$/)]) }),
  z.object({ fn: z.literal('setMaxExposureBps'), args: z.tuple([z.number().int().min(1).max(10_000)]) }),
  z.object({ fn: z.literal('setAdapterStatus'), args: z.tuple([AddressSchema, AdapterStatusSchema]) }),
]);

export const DemoPrepareRequestSchema = z.object({
  fn: z.enum(['advanceTime', 'setAPY', 'setPaused', 'setUtilization', 'setLiquidityShortage', 'resetCircuitBreaker']),
  args: z.array(PreparedArgSchema).default([]),
});

// ---- §3.1 auth, §4.5–§4.8 other documented request bodies -----------------------------------------------------
export const AuthVerifyRequestSchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export const StressScenarioIdSchema = z.enum(['APY_DROP_50', 'POOL_LOCK_14D', 'INFLOW_DELAY_30D', 'EXPENSE_PLUS_20']);
export const StressTestRequestSchema = z.object({
  scenarios: z.array(StressScenarioIdSchema).min(1).optional(),
});

export const CreateInflowRequestSchema = z.object({
  label: LabelSchema,
  amount: AmountStringSchema,
  expectedDate: UnixSecondsSchema.positive(),
});

export const RejectRecommendationRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const TransactionKindSchema = z.enum([
  'CREATE_OBLIGATION',
  'UPDATE_OBLIGATION',
  'CANCEL_OBLIGATION',
  'INVEST',
  'WITHDRAW',
  'PAY',
  'ENFORCE_DEADLINES',
  'TRIP_BREAKER',
  'RESET_BREAKER',
  'SET_POLICY',
  'SET_ADAPTER_STATUS',
  'ADVANCE_TIME',
  'POOL_CONTROL',
  'OTHER',
]);

export const RegisterTransactionRequestSchema = z.object({
  txHash: TxHashSchema,
  kind: TransactionKindSchema,
  relatedDraftId: z.string().min(1).optional(),
});

export const CashLadderQuerySchema = z.object({
  projectionDays: z.coerce.number().int().min(1).max(365).default(60),
  includeYield: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateObligationRequest = z.infer<typeof CreateObligationRequestSchema>;
export type UpdateObligationRequest = z.infer<typeof UpdateObligationRequestSchema>;
export type ParseObligationsRequest = z.infer<typeof ParseObligationsRequestSchema>;
export type VaultWithdrawalRequest = z.infer<typeof VaultWithdrawalRequestSchema>;
export type VaultInvestmentRequest = z.infer<typeof VaultInvestmentRequestSchema>;
export type PolicyPrepareRequest = z.infer<typeof PolicyPrepareRequestSchema>;
export type DemoPrepareRequest = z.infer<typeof DemoPrepareRequestSchema>;
export type RegisterTransactionRequest = z.infer<typeof RegisterTransactionRequestSchema>;
