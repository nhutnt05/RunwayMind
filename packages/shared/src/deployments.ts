// Deployment address files (docs/11 §7 `deployment/fuji.json`). `sync-abi` copies deployment/*.json into
// src/deployments/; this module validates them. No I/O and no side effects (docs/14 §2): callers pass the parsed JSON
// (e.g. `import fuji from '@runwaymind/shared/deployments/fuji.json'` or `JSON.parse(readFileSync(...))`).
import { z } from 'zod';
import { AddressSchema } from './schemas/common';

export const DeploymentSchema = z.object({
  chainId: z.number().int().positive(),
  deployBlock: z.string().regex(/^\d+$/).transform((v) => BigInt(v)),
  demoMode: z.boolean(),
  // Deploy.s.sol writes 0 until SeedDemo.s.sol records T0; 0 is normalized to null ("not seeded").
  demoStartTime: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  contracts: z.object({
    MockUSDC: AddressSchema.optional(),
    ObligationRegistry: AddressSchema,
    PolicyEngine: AddressSchema,
    Treasury: AddressSchema,
    MockLendingPool: AddressSchema,
    VaultAdapter: AddressSchema,
  }),
  roles: z.object({ admin: AddressSchema, agent: AddressSchema }),
});

export type Deployment = z.infer<typeof DeploymentSchema>;

/** Validates a deployment JSON object; throws a ZodError naming the missing / malformed field. */
export function loadDeployment(json: unknown): Deployment {
  return DeploymentSchema.parse(json);
}

/**
 * Picks and validates the deployment for a chain from the generated `deploymentFiles` map. The primary file
 * (`fuji`, `local` — no `-suffix`) wins over secondary treasuries on the same chain (e.g. `fuji-usdc`, docs/11 §7.2).
 */
export function deploymentForChain(files: Record<string, unknown>, chainId: number): Deployment | null {
  const ordered = Object.entries(files).sort(([a], [b]) => Number(a.includes('-')) - Number(b.includes('-')));
  for (const [, raw] of ordered) {
    const parsed = DeploymentSchema.safeParse(raw);
    if (parsed.success && parsed.data.chainId === chainId) return parsed.data;
  }
  return null;
}
