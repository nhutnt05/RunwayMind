import { describe, expect, it } from 'vitest';
import {
  AgentSettingsSchema,
  AgentSettingsUpdateSchema,
  CreateObligationRequestSchema,
  NLParseLLMOutputSchema,
  UpdateObligationRequestSchema,
  VaultWithdrawalRequestSchema,
} from '../src';

const RECIPIENT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

const validCreate = {
  label: 'December payroll',
  notes: null,
  category: 'PAYROLL',
  recipient: RECIPIENT,
  amount: '20000000000',
  firstDueDate: 1_795_910_400,
  interval: 0,
  maxOccurrences: 1,
  source: 'FORM',
  nlDraftId: null,
};

describe('CreateObligationRequestSchema (docs/07 §5.1)', () => {
  it('accepts the documented example and checksums the recipient', () => {
    const parsed = CreateObligationRequestSchema.parse(validCreate);
    expect(parsed.recipient).toBe('0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD');
  });

  it('enforces V3 amount > 0 and the 10^15 sanity cap', () => {
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, amount: '0' }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, amount: '1000000000000001' }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, amount: '20000.5' }).success).toBe(false);
  });

  it('enforces V5 interval bounds', () => {
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, interval: 3600, maxOccurrences: 0 }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, interval: 31_536_001, maxOccurrences: 0 }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, interval: 2_592_000, maxOccurrences: 0 }).success).toBe(true);
  });

  it('enforces V6 occurrences', () => {
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, maxOccurrences: 2 }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, interval: 86_400, maxOccurrences: 1 }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, interval: 86_400, maxOccurrences: 2 }).success).toBe(true);
  });

  it('rejects bad addresses and labels over 80 chars', () => {
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, recipient: '0x123' }).success).toBe(false);
    expect(CreateObligationRequestSchema.safeParse({ ...validCreate, label: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('UpdateObligationRequestSchema', () => {
  it('requires at least one field and rejects unknown keys', () => {
    expect(UpdateObligationRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateObligationRequestSchema.safeParse({ label: 'x' }).success).toBe(true);
    expect(UpdateObligationRequestSchema.safeParse({ interval: 0 }).success).toBe(false);
  });
});

describe('VaultWithdrawalRequestSchema (docs/07 §5.5)', () => {
  it('accepts MAX and defaults executeVia to AGENT', () => {
    const parsed = VaultWithdrawalRequestSchema.parse({ adapter: RECIPIENT, amount: 'MAX' });
    expect(parsed.amount).toBe('MAX');
    expect(parsed.executeVia).toBe('AGENT');
  });
});

describe('AgentSettingsSchema (docs/09 §6)', () => {
  const defaults = {
    mode: 'APPROVE',
    minApyBps: 300,
    riskInvestThreshold: 70,
    riskWithdrawThreshold: 40,
    minActionAmount: '100000000',
    preWithdrawLeadDays: 2,
    decisionTtlSec: 600,
    loopIntervalSec: 30,
  };

  it('accepts the documented defaults', () => {
    expect(AgentSettingsSchema.safeParse(defaults).success).toBe(true);
  });

  it('enforces bounds and threshold ordering', () => {
    expect(AgentSettingsSchema.safeParse({ ...defaults, minApyBps: 10_001 }).success).toBe(false);
    expect(AgentSettingsSchema.safeParse({ ...defaults, preWithdrawLeadDays: 15 }).success).toBe(false);
    expect(AgentSettingsSchema.safeParse({ ...defaults, loopIntervalSec: 4 }).success).toBe(false);
    expect(AgentSettingsSchema.safeParse({ ...defaults, riskWithdrawThreshold: 70 }).success).toBe(false);
  });

  it('partial update validates thresholds only when both are present', () => {
    expect(AgentSettingsUpdateSchema.safeParse({ mode: 'AUTO' }).success).toBe(true);
    expect(AgentSettingsUpdateSchema.safeParse({ riskWithdrawThreshold: 50 }).success).toBe(true);
    expect(AgentSettingsUpdateSchema.safeParse({ riskWithdrawThreshold: 80, riskInvestThreshold: 70 }).success).toBe(false);
  });
});

describe('NLParseLLMOutputSchema (docs/05 §6.2)', () => {
  it('accepts a monthly payroll draft with null recipient', () => {
    const result = NLParseLLMOutputSchema.safeParse({
      obligations: [
        {
          label: 'Monthly payroll',
          category: 'PAYROLL',
          recipient: null,
          amount: '20000',
          currency: 'USDC',
          firstDueDate: '2026-12-01',
          recurrence: { type: 'MONTHLY', everyNDays: null, occurrences: null },
          sourceSpan: 'Lương 20k ngày 1',
        },
      ],
      needsClarification: ['recipient'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects other currencies and more than 10 drafts', () => {
    const draft = {
      label: 'x',
      category: 'OTHER',
      recipient: null,
      amount: '1',
      currency: 'EUR',
      firstDueDate: '2026-12-01',
      recurrence: { type: 'NONE', everyNDays: null, occurrences: null },
      sourceSpan: 'x',
    };
    expect(NLParseLLMOutputSchema.safeParse({ obligations: [draft], needsClarification: [] }).success).toBe(false);
    const usd = { ...draft, currency: 'USDC' };
    expect(NLParseLLMOutputSchema.safeParse({ obligations: Array(11).fill(usd), needsClarification: [] }).success).toBe(false);
  });
});
