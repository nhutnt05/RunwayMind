// Seed: TreasuryConfig from deployment/<network>.json, its Pool, default AgentSettings, and labels for the demo
// obligations created by scripts/SeedDemo.s.sol (docs/09 §8, docs/02 §H step 11).
import { readFileSync } from 'node:fs';
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

async function main() {
  const deploymentFile = resolve(backendRoot, (process.env.DEPLOYMENT_FILE ?? '../deployment/fuji.json').replace(/\s+#.*$/, ''));
  const d = loadDeployment(JSON.parse(readFileSync(deploymentFile, 'utf8')));
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const symbol = d.contracts.MockUSDC ? 'mUSDC' : 'USDC';
  const id = `${NETWORK_BY_CHAIN[d.chainId] ?? d.chainId}-${symbol.toLowerCase()}`;

  await prisma.treasuryConfig.upsert({
    where: { id },
    create: {
      id,
      chainId: d.chainId,
      treasuryAddress: d.contracts.Treasury,
      registryAddress: d.contracts.ObligationRegistry,
      policyAddress: d.contracts.PolicyEngine,
      assetAddress: d.contracts.MockUSDC ?? '',
      assetSymbol: symbol,
      assetDecimals: 6,
      deployBlock: d.deployBlock.toString(),
      demoStartTime: d.demoStartTime,
      isPrimary: true,
    },
    update: {
      treasuryAddress: d.contracts.Treasury,
      registryAddress: d.contracts.ObligationRegistry,
      policyAddress: d.contracts.PolicyEngine,
      assetAddress: d.contracts.MockUSDC ?? '',
      deployBlock: d.deployBlock.toString(),
      demoStartTime: d.demoStartTime,
    },
  });

  await prisma.pool.upsert({
    where: { adapterAddress: d.contracts.VaultAdapter },
    create: {
      adapterAddress: d.contracts.VaultAdapter,
      poolAddress: d.contracts.MockLendingPool,
      treasuryId: id,
      name: 'Mock Lending Pool (mUSDC)',
      kind: 'MOCK',
    },
    update: { poolAddress: d.contracts.MockLendingPool, treasuryId: id },
  });

  await prisma.agentSettings.upsert({
    where: { treasuryId: id },
    create: { treasuryId: id, ...DEFAULT_AGENT_SETTINGS, minActionAmount: DEFAULT_AGENT_SETTINGS.minActionAmount.toString() },
    update: {},
  });

  if (d.demoStartTime !== null && process.env.SEED_OBLIGATIONS !== 'false') {
    for (const m of DEMO_SEED_METADATA) {
      const meta = { label: m.label, notes: null, category: m.category, source: 'SEED' };
      await prisma.obligationMetadata.upsert({
        where: { treasuryId_obligationId: { treasuryId: id, obligationId: m.obligationId } },
        create: { treasuryId: id, obligationId: m.obligationId, label: m.label, notes: null, source: 'SEED', metadataHash: metadataHash(meta), createTxHash: '' },
        update: { label: m.label, metadataHash: metadataHash(meta) },
      });
    }
  }

  console.log(`Seeded TreasuryConfig ${id} (Treasury ${d.contracts.Treasury}) from ${deploymentFile}`);
  await prisma.$disconnect();
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
