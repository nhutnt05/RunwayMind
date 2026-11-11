// Agent configuration from the single root .env (docs/14 §4). Validated with zod at startup; keys only from env.
import { z } from 'zod';

const optionalKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex private key')
  .optional()
  .or(z.literal('').transform(() => undefined));

/** Strips trailing ` # comment` that docs/11 §4 puts after some values. */
const stripComment = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v);

export const AgentConfigSchema = z.object({
  CHAIN_ID: z.preprocess(stripComment, z.coerce.number().int().positive()).default(43113),
  FUJI_RPC_URL: z.preprocess(stripComment, z.string().url()),
  FUJI_RPC_URL_FALLBACK: z.preprocess(stripComment, z.string().url().optional().or(z.literal('').transform(() => undefined))),
  AGENT_PRIVATE_KEY: z.preprocess(stripComment, optionalKey),
  KEEPER_PRIVATE_KEY: z.preprocess(stripComment, optionalKey),
  DEPLOYMENT_FILE: z.preprocess(stripComment, z.string().min(1)).default('../deployment/fuji.json'),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Throws an Error listing every missing / invalid variable (callers exit the process with that message). */
export function loadAgentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  const parsed = AgentConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid agent configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
