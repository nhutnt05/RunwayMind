// POST /obligations/parse (docs/07 §5.4, docs/05 §6): ADMIN natural-language input → ObligationDraft rows (status
// DRAFT). Drafts are only suggestions: they are submitted through POST /obligations with `nlDraftId`, validated again,
// simulated and signed by the ADMIN wallet. Rate limit: 10 requests / minute per wallet.
import type { Address } from 'viem';
import { NlParseError, parseObligations, type AuditLogger, type LlmProvider } from '@runwaymind/agent';
import type { ParseObligationsRequest } from '@runwaymind/shared';
import { ApiError } from '../errors';
import type { Repositories } from '../repositories';
import { newId } from '../repositories/agentStore';
import type { ChainService } from './chain';

export const NL_RATE_LIMIT = { max: 10, windowMs: 60_000 } as const;

/** Sliding-window limiter keyed by wallet (in-memory; one API process — docs/01 deployment). */
export function createRateLimiter(max: number, windowMs: number, now: () => number = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    /** Records a hit; returns seconds until the next allowed request, or 0 when allowed. */
    take(key: string): number {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return Math.ceil((windowMs - (t - recent[0]!)) / 1000);
      }
      recent.push(t);
      hits.set(key, recent);
      return 0;
    },
  };
}

export interface NlServiceDeps {
  chain: ChainService;
  repos: Repositories;
  audit: AuditLogger;
  llm: { provider: LlmProvider | null; timeoutMs: number };
  now?: () => number;
}

export function createNlService({ chain, repos, audit, llm, now }: NlServiceDeps) {
  const limiter = createRateLimiter(NL_RATE_LIMIT.max, NL_RATE_LIMIT.windowMs, now);

  return {
    async parse(body: ParseObligationsRequest, by: Address) {
      const retryAfter = limiter.take(by.toLowerCase());
      if (retryAfter > 0) {
        throw new ApiError('RATE_LIMITED', `Too many parse requests: max ${NL_RATE_LIMIT.max} per minute`, { retryAfterSec: retryAfter });
      }
      const s = await chain.getSnapshot();
      const totalAssets = s.idle + s.adapters.reduce((sum, a) => sum + a.balance, 0n);
      let result;
      try {
        result = await parseObligations(
          { text: body.text, locale: body.locale, chainTime: s.chainTime, treasury: s.treasury, totalAssets, decimals: s.assetDecimals },
          { provider: llm.provider, timeoutMs: llm.timeoutMs },
        );
      } catch (e) {
        if (e instanceof NlParseError) {
          await audit.record('NL_PARSE', { ok: false, code: e.code, locale: body.locale }, { actor: by, entityType: 'NL' });
          if (e.code === 'INVALID_OUTPUT') throw new ApiError('NL_PARSE_FAILED', 'Could not understand the text; please rephrase or use the form');
          throw new ApiError('LLM_UNAVAILABLE', e.message);
        }
        throw e;
      }

      const drafts = [];
      for (const d of result.drafts) {
        const draftId = newId('drf');
        await repos.saveDraft({
          id: draftId,
          status: 'DRAFT',
          source: 'NL',
          label: d.label,
          category: d.category,
          recipient: d.recipient,
          amount: d.amount.toString(),
          firstDueDate: d.firstDueDate,
          interval: d.interval,
          maxOccurrences: d.maxOccurrences,
          warnings: d.warnings,
          sourceText: body.text,
          createdBy: by,
        });
        drafts.push({ draftId, ...d });
      }
      await audit.record(
        'NL_PARSE',
        { ok: true, locale: body.locale, drafts: drafts.map((d) => d.draftId), needsClarification: result.needsClarification.length, latencyMs: result.llm.latencyMs },
        { actor: by, entityType: 'NL', ...(drafts[0] ? { entityId: drafts[0].draftId } : {}) },
      );
      return { drafts, needsClarification: result.needsClarification, llm: { provider: result.llm.provider, latencyMs: result.llm.latencyMs } };
    },
  };
}

export type NlService = ReturnType<typeof createNlService>;
