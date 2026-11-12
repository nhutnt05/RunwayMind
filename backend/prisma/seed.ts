// Seed: TreasuryConfig from deployment/<network>.json, its Pool, default AgentSettings, and labels for the demo
// obligations created by scripts/SeedDemo.s.sol (docs/09 §8, docs/02 §H step 11).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { keccak256, toBytes } from 'viem';
import { DEFAULT_AGENT_SETTINGS, loadDeployment, type Category } from '@runwaymind/shared';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: resolve(backendRoot, '..', '.env') });

/** Labels must match scripts/SeedDemo.s.sol (metadataHash = keccak256 of the canonical JSON below). */
export const DEMO_SEED_METADATA: { obligationId: string; label: string; category: Category }[] = [
  { obligationId: '1', label: 'November payroll', category: 'PAYROLL' },
  { obligationId: '2', label: 'December payroll', category: 'PAYROLL' },
  { obligationId: '3', label: 'Q1 grant', category: 'GRANT' },
];

/** docs/07 §5.1: keccak256(canonicalJson({ label, notes, category, source })) — keys sorted, no whitespace. */
export function metadataHash(m: { label: string; notes: string | null; category: Category; source: string }): `0x${string}` {
  const canonical = JSON.stringify({ category: m.category, label: m.label, notes: m.notes, source: m.source });
  return keccak256(toBytes(canonical));
}

const NETWORK_BY_CHAIN: Record<number, string> = { 31337: 'local', 43113: 'fuji' };

/** Circle USDC on Fuji (docs/02 §H real-USDC paragraph); real-USDC deployment files carry no MockUSDC address. */
export const CIRCLE_USDC_FUJI = '0x5425890298aed601595a70AB815c96711a31Bc65';

export interface SeedOptions {
  chainId: number;
  /** false → TreasuryConfig/Pool/AgentSettings only, no demo obligation labels (SEED_OBLIGATIONS=false). */
  seedObligations: boolean;
  /** Asset of real-USDC deployments (no MockUSDC in the file). */
  realUsdcAddress?: string;
  log?: (msg: string) => void;
}

/**
 * Registers every `deployment/*.json` of `opts.chainId` as a TreasuryConfig (D6-B1, docs/11 §7.2): the primary file
 * (`fuji.json`, no `-suffix`) → `fuji-musdc` with isPrimary=true; `fuji-usdc.json` → `fuji-usdc`, isPrimary=false.
 * Idempotent (upserts). Demo obligation labels are written for the primary treasury only.
 */
export async function seedTreasuries(prisma: PrismaClient, deploymentDir: string, opts: SeedOptions): Promise<string[]> {
  const files = readdirSync(deploymentDir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => Number(a.includes('-')) - Number(b.includes('-')) || a.localeCompare(b));
  const seeded: string[] = [];
  let primarySeeded: string | null = null;
  for (const file of files) {
    let d;
    try {
      d = loadDeployment(JSON.parse(readFileSync(resolve(deploymentDir, file), 'utf8')));
    } catch {
      opts.log?.(`skip ${file}: not a deployment file`);
      continue;
    }
    if (d.chainId !== opts.chainId) continue;
    const primary = !file.replace(/\.json$/, '').includes('-');
    const symbol = d.contracts.MockUSDC ? 'mUSDC' : 'USDC';
    const asset = d.contracts.MockUSDC ?? opts.realUsdcAddress ?? CIRCLE_USDC_FUJI;
    const id = `${NETWORK_BY_CHAIN[d.chainId] ?? d.chainId}-${symbol.toLowerCase()}`;
    const fields = {
      chainId: d.chainId,
      treasuryAddress: d.contracts.Treasury,
      registryAddress: d.contracts.ObligationRegistry,
      policyAddress: d.contracts.PolicyEngine,
      assetAddress: asset,
      assetSymbol: symbol,
      assetDecimals: 6,
      deployBlock: d.deployBlock.toString(),
      demoStartTime: d.demoStartTime,
      isPrimary: primary,
    };
    await prisma.treasuryConfig.upsert({ where: { id }, create: { id, ...fields }, update: fields });
    await prisma.pool.upsert({
      where: { adapterAddress: d.contracts.VaultAdapter },
      create: {
        adapterAddress: d.contracts.VaultAdapter,
        poolAddress: d.contracts.MockLendingPool,
        treasuryId: id,
        name: `Mock Lending Pool (${symbol})`,
        kind: 'MOCK',
      },
      update: { poolAddress: d.contracts.MockLendingPool, treasuryId: id },
    });
    await prisma.agentSettings.upsert({
      where: { treasuryId: id },
      create: { treasuryId: id, ...DEFAULT_AGENT_SETTINGS, minActionAmount: DEFAULT_AGENT_SETTINGS.minActionAmount.toString() },
      update: {},
    });
    if (primary && d.demoStartTime !== null && opts.seedObligations) {
      for (const m of DEMO_SEED_METADATA) {
        const meta = { label: m.label, notes: null, category: m.category, source: 'SEED' };
        await prisma.obligationMetadata.upsert({
          where: { treasuryId_obligationId: { treasuryId: id, obligationId: m.obligationId } },
          create: { treasuryId: id, obligationId: m.obligationId, label: m.label, notes: null, source: 'SEED', metadataHash: metadataHash(meta), createTxHash: '' },
          update: { label: m.label, metadataHash: metadataHash(meta) },
        });
      }
    }
    seeded.push(id);
    if (primary && primarySeeded === null) primarySeeded = id;
    opts.log?.(`Seeded TreasuryConfig ${id}${primary ? ' (primary)' : ''} (Treasury ${d.contracts.Treasury}) from ${file}`);
  }
  // Exactly one primary per chain.
  const primaryId = primarySeeded ?? seeded[0];
  if (primaryId) {
    await prisma.treasuryConfig.updateMany({ where: { chainId: opts.chainId, id: { not: primaryId } }, data: { isPrimary: false } });
    await prisma.treasuryConfig.update({ where: { id: primaryId }, data: { isPrimary: true } });
  }
  return seeded;
}

async function main() {
  const clean = (v: string | undefined) => v?.replace(/\s+#.*$/, '').trim();
  const prisma = new PrismaClient({ datasourceUrl: clean(process.env.DATABASE_URL) });
  const seeded = await seedTreasuries(prisma, resolve(backendRoot, '..', 'deployment'), {
    chainId: Number(clean(process.env.CHAIN_ID) ?? 43113),
    seedObligations: process.env.SEED_OBLIGATIONS !== 'false',
    ...(clean(process.env.CIRCLE_USDC_FUJI) ? { realUsdcAddress: clean(process.env.CIRCLE_USDC_FUJI)! } : {}),
    log: (m) => console.log(m),
  });
  if (seeded.length === 0) console.warn('No deployment file matched CHAIN_ID — nothing seeded.');
  await prisma.$disconnect();
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
