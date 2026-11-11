// AgentSettings validation (docs/05 §5.1 fields, docs/09 §6 bounds).
import { z } from 'zod';
import { AmountStringSchema } from './common';

const AgentSettingsFields = {
  mode: z.enum(['APPROVE', 'AUTO']),
  minApyBps: z.number().int().min(0).max(10_000),
  riskInvestThreshold: z.number().int().min(0).max(100),
  riskWithdrawThreshold: z.number().int().min(0).max(100),
  minActionAmount: AmountStringSchema, // base units, JSON string
  preWithdrawLeadDays: z.number().int().min(0).max(14),
  decisionTtlSec: z.number().int().positive(),
  loopIntervalSec: z.number().int().min(5).max(600),
};

const THRESHOLD_MESSAGE = 'riskWithdrawThreshold must be lower than riskInvestThreshold';

/** Full settings object as stored / returned by `GET /agent/settings`. */
export const AgentSettingsSchema = z
  .object(AgentSettingsFields)
  .strict()
  .refine((s) => s.riskWithdrawThreshold < s.riskInvestThreshold, {
    message: THRESHOLD_MESSAGE,
    path: ['riskWithdrawThreshold'],
  });

/**
 * Body of `PUT /agent/settings` (partial update, docs/07 §4.7). The cross-field threshold rule is checked here when
 * both thresholds are present; the backend must re-check it after merging with stored settings.
 */
export const AgentSettingsUpdateSchema = z
  .object(AgentSettingsFields)
  .partial()
  .strict()
  .refine(
    (s) =>
      s.riskWithdrawThreshold === undefined ||
      s.riskInvestThreshold === undefined ||
      s.riskWithdrawThreshold < s.riskInvestThreshold,
    { message: THRESHOLD_MESSAGE, path: ['riskWithdrawThreshold'] },
  );

export type AgentSettingsJson = z.infer<typeof AgentSettingsSchema>;
export type AgentSettingsUpdate = z.infer<typeof AgentSettingsUpdateSchema>;
