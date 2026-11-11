// AI Explainer (REQ-044, docs/05 §7, §12). Turns an already-computed decision into human text. The LLM only sees
// FACTS and may only copy their numbers; any failure falls back to the deterministic template.
import { z } from 'zod';
import type { AgentDecisionDraft, AgentSettings, Explanation } from '@runwaymind/shared';
import { silentLogger, type AuditLogger, type Logger } from '../audit/audit';
import { checkGrounding } from './grounding';
import { LlmTimeoutError, callWithTimeout, type LlmProvider } from './provider';
import { templateExplanation, type ExplanationLanguage } from './templates';

const MAX_EXPLANATION_WORDS = 60;

/** docs/05 §7.1 output: {"headline": string(<=80), "explanation": string, "reasons": string[1..3], "riskNote": string|null} */
export const ExplanationSchema = z.object({
  headline: z.string().min(1).max(80),
  explanation: z
    .string()
    .min(1)
    .refine((s) => s.trim().split(/\s+/).length <= MAX_EXPLANATION_WORDS, `explanation must be at most ${MAX_EXPLANATION_WORDS} words`),
  reasons: z.array(z.string().min(1)).min(1).max(3),
  riskNote: z.string().nullable(),
});

export type ExplanationOutput = z.infer<typeof ExplanationSchema>;

export type FallbackReason = 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_OUTPUT' | 'GROUNDING_FAILED' | 'PROMPT_INJECTION';

const LANGUAGE_NAME: Record<ExplanationLanguage, string> = { en: 'English', vi: 'Vietnamese' };

/** System prompt, verbatim from docs/05 §7.1 with placeholders filled. */
export function buildExplainPrompt(d: Pick<AgentDecisionDraft, 'action' | 'reasonCode' | 'facts'>, language: ExplanationLanguage): string {
  return [
    `You are RunwayMind, an AI CFO. Explain a treasury action to a DAO treasurer in ${LANGUAGE_NAME[language]}.`,
    'Use ONLY the numbers in FACTS, copied exactly as written (same digits and decimals). Do not compute new numbers.',
    'Do not recommend a different action. Max 60 words for "explanation".',
    'Output JSON: {"headline": string(<=80 chars), "explanation": string, "reasons": string[1..3], "riskNote": string|null}',
    `FACTS: ${JSON.stringify(d.facts)}`,
    `ACTION: ${d.action} REASON_CODE: ${d.reasonCode}`,
  ].join('\n');
}

const USER_MESSAGE = 'Return the JSON object now.';

export interface ExplainerDeps {
  /** null → LLM disabled: templates only, no network (docs/05 §12). */
  provider: LlmProvider | null;
  timeoutMs: number;
  audit?: AuditLogger | null;
  language?: ExplanationLanguage;
  log?: Logger;
}

export interface ExplainResult {
  explanation: Explanation;
  fallbackReason: FallbackReason | null;
}

type Attempt = { ok: true; value: ExplanationOutput } | { ok: false; reason: FallbackReason; detail: string; repair?: string };

async function attempt(provider: LlmProvider, system: string, user: string, timeoutMs: number): Promise<Attempt> {
  let raw: string;
  try {
    raw = await callWithTimeout(provider, { system, user }, timeoutMs);
  } catch (e) {
    return e instanceof LlmTimeoutError
      ? { ok: false, reason: 'TIMEOUT', detail: e.message }
      : { ok: false, reason: 'PROVIDER_ERROR', detail: (e as Error).message };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'INVALID_OUTPUT', detail: (e as Error).message, repair: `Invalid JSON: ${(e as Error).message}` };
  }
  const parsed = ExplanationSchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, reason: 'INVALID_OUTPUT', detail: msg, repair: `Schema errors: ${msg}` };
  }
  return { ok: true, value: parsed.data };
}

export function createExplainer(deps: ExplainerDeps) {
  const language = deps.language ?? 'en';
  const log = deps.log ?? silentLogger;

  async function fallback(d: AgentDecisionDraft, settings: AgentSettings, reason: FallbackReason, detail: unknown): Promise<ExplainResult> {
    log.warn('LLM explanation fallback', { reason, reasonCode: d.reasonCode, snapshotId: d.snapshotId });
    await deps.audit?.record(
      'LLM_FALLBACK',
      { reason, detail, action: d.action, reasonCode: d.reasonCode },
      { entityType: 'SNAPSHOT', entityId: d.snapshotId },
    );
    return { explanation: templateExplanation({ ...d, minApyBps: settings.minApyBps, language }), fallbackReason: reason };
  }

  /** Explanation + why a fallback happened (for tests / diagnostics). */
  async function explainDetailed(d: AgentDecisionDraft, settings: AgentSettings): Promise<ExplainResult> {
    if (!deps.provider) {
      return { explanation: templateExplanation({ ...d, minApyBps: settings.minApyBps, language }), fallbackReason: null };
    }
    const system = buildExplainPrompt(d, language);
    // docs/05 §12: timeout → 1 retry; invalid JSON/schema → 1 repair retry with the zod error appended.
    let res = await attempt(deps.provider, system, USER_MESSAGE, deps.timeoutMs);
    if (!res.ok) {
      const user = res.repair ? `${USER_MESSAGE}\nYour previous output was rejected. ${res.repair}` : USER_MESSAGE;
      res = await attempt(deps.provider, system, user, deps.timeoutMs);
    }
    if (!res.ok) return fallback(d, settings, res.reason, res.detail);

    const g = checkGrounding(res.value, d.facts, settings.minApyBps);
    if (g.unknownAddresses.length > 0) return fallback(d, settings, 'PROMPT_INJECTION', g);
    if (!g.ok) return fallback(d, settings, 'GROUNDING_FAILED', g);

    return { explanation: { ...res.value, source: 'LLM' }, fallbackReason: null };
  }

  /** Signature expected by `AgentLoopDeps.explain`. */
  async function explain(d: AgentDecisionDraft, settings: AgentSettings): Promise<Explanation> {
    return (await explainDetailed(d, settings)).explanation;
  }

  return { explain, explainDetailed };
}

export type Explainer = ReturnType<typeof createExplainer>;
