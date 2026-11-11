// Backend configuration from the single root .env (docs/11 §4, docs/14 §4). Validated with zod at startup.
import { z } from 'zod';

/** docs/11 §4 writes some values with a trailing ` # comment`; strip it before validation. */
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v);
const str = () => z.preprocess(clean, z.string().min(1));
const bool = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : clean(v) === 'true'), z.boolean());

export const BackendConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CHAIN_ID: z.preprocess(clean, z.coerce.number().int().positive()).default(43113),
  FUJI_RPC_URL: z.preprocess(clean, z.string().url()),
  FUJI_RPC_URL_FALLBACK: z.preprocess(clean, z.string().url().optional().or(z.literal('').transform(() => undefined))),
  PORT: z.preprocess(clean, z.coerce.number().int().positive()).default(4000),
  DATABASE_URL: str(),
  SESSION_SECRET: z.preprocess(clean, z.string().min(32, 'SESSION_SECRET must be at least 32 characters')),
  APP_ORIGIN: z.preprocess(clean, z.string().url()),
  DEPLOYMENT_FILE: str().default('../deployment/fuji.json'),
  AGENT_ENABLED: bool(true),
  KEEPER_ENABLED: bool(true),
  LLM_ENABLED: bool(true),
});

export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export function loadBackendConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  const parsed = BackendConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid backend configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
