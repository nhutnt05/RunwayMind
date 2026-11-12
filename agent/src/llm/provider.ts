// LLM provider (docs/05 §7, §12; docs/11 §4; A-14). JSON-only chat completion behind a tiny interface so the
// explainer (and later the NL parser) can be tested with a mocked provider. Keys come only from env.
// The LLM never produces numbers used in transactions: its output is text for humans, checked by grounding.ts.
import { z } from 'zod';

export type LlmProviderName = 'anthropic' | 'openai';

export interface LlmRequest {
  system: string;
  user: string;
  /** Aborted by the caller on timeout. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  /** Returns the raw model text, which must be a JSON object (JSON mode). */
  completeJson(req: LlmRequest): Promise<string>;
}

export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`LLM call timed out after ${timeoutMs} ms`);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

const stripComment = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v);
const boolish = z.preprocess(
  (v) => {
    const s = stripComment(v);
    return typeof s === 'string' ? s.toLowerCase() === 'true' || s === '1' : s;
  },
  z.boolean(),
);

export const LlmConfigSchema = z.object({
  LLM_ENABLED: boolish.default(false),
  LLM_PROVIDER: z.preprocess(stripComment, z.enum(['anthropic', 'openai'])).default('anthropic'),
  LLM_MODEL: z.preprocess(stripComment, z.string()).default(''),
  LLM_API_KEY: z.preprocess(stripComment, z.string()).default(''),
  LLM_TIMEOUT_MS: z.preprocess(stripComment, z.coerce.number().int().positive()).default(8000),
  /** Optional API-compatible endpoint (e.g. a relay). Unset → the provider's official API. HTTPS only. */
  LLM_BASE_URL: z.preprocess(
    (v) => {
      const s = stripComment(v);
      return s === '' ? undefined : s;
    },
    z.string().url().refine((u) => u.startsWith('https://'), 'LLM_BASE_URL must use https').optional(),
  ),
});

export interface LlmConfig {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
  apiKey: string;
  timeoutMs: number;
  /** Base URL without trailing slash; undefined → official API. */
  baseUrl?: string;
}

export const DEFAULT_BASE_URL: Record<LlmProviderName, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};

const base = (cfg: { baseUrl?: string | undefined }, provider: LlmProviderName) => (cfg.baseUrl ?? DEFAULT_BASE_URL[provider]).replace(/\/+$/, '');

/**
 * Reads LLM_* from env. The LLM counts as enabled only when LLM_ENABLED=true AND a model and key are set; otherwise
 * everything falls back to templates (docs/05 §12 "Provider quota" row).
 */
export function loadLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const p = LlmConfigSchema.parse(env);
  return {
    enabled: p.LLM_ENABLED && p.LLM_MODEL.length > 0 && p.LLM_API_KEY.length > 0,
    provider: p.LLM_PROVIDER,
    model: p.LLM_MODEL,
    apiKey: p.LLM_API_KEY,
    timeoutMs: p.LLM_TIMEOUT_MS,
    ...(p.LLM_BASE_URL ? { baseUrl: p.LLM_BASE_URL } : {}),
  };
}

type FetchLike = typeof fetch;

const MAX_TOKENS = 1024;

/** Pulls the first JSON object out of a model reply (tolerates ```json fences). */
export function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    // Never echo request headers (API key) into errors/logs.
    const detail = await res.text().catch(() => '');
    throw new LlmProviderError(`LLM HTTP ${res.status}: ${detail.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as unknown;
}

export function createAnthropicProvider(cfg: Pick<LlmConfig, 'model' | 'apiKey' | 'baseUrl'>, fetchImpl: FetchLike = fetch): LlmProvider {
  return {
    name: 'anthropic',
    async completeJson({ system, user, signal }) {
      const json = (await postJson(
        fetchImpl,
        `${base(cfg, 'anthropic')}/v1/messages`,
        { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: cfg.model,
          max_tokens: MAX_TOKENS,
          system: `${system}\nRespond with a single JSON object only, no prose.`,
          messages: [{ role: 'user', content: user }],
        },
        signal,
      )) as { content?: { type: string; text?: string }[] };
      const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      if (!text) throw new LlmProviderError('LLM returned no text content');
      return extractJsonObject(text);
    },
  };
}

export function createOpenAiProvider(cfg: Pick<LlmConfig, 'model' | 'apiKey' | 'baseUrl'>, fetchImpl: FetchLike = fetch): LlmProvider {
  return {
    name: 'openai',
    async completeJson({ system, user, signal }) {
      const json = (await postJson(
        fetchImpl,
        `${base(cfg, 'openai')}/v1/chat/completions`,
        { authorization: `Bearer ${cfg.apiKey}` },
        {
          model: cfg.model,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
        signal,
      )) as { choices?: { message?: { content?: string | null } }[] };
      const text = json.choices?.[0]?.message?.content ?? '';
      if (!text) throw new LlmProviderError('LLM returned no content');
      return extractJsonObject(text);
    },
  };
}

/** Returns null when the LLM is disabled (templates only, no network). */
export function createLlmProvider(cfg: LlmConfig, fetchImpl: FetchLike = fetch): LlmProvider | null {
  if (!cfg.enabled) return null;
  return cfg.provider === 'openai' ? createOpenAiProvider(cfg, fetchImpl) : createAnthropicProvider(cfg, fetchImpl);
}

/**
 * Runs one provider call with a hard timeout. Uses both an AbortSignal (cancels the HTTP request) and a race (so a
 * provider that ignores the signal still cannot block the agent loop).
 */
export async function callWithTimeout(provider: LlmProvider, req: Omit<LlmRequest, 'signal'>, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new LlmTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.completeJson({ ...req, signal: ctrl.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
