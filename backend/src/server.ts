// Backend entry point: `pnpm --filter @runwaymind/backend dev` / `node dist/server.js` (docs/11 §5, §10).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { createChainPublicClient } from '@runwaymind/agent';
import { loadDeployment } from '@runwaymind/shared';
import { buildApp } from './app';
import { loadBackendConfig } from './config';
import { ViemChainService } from './services/chain';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');

async function main() {
  loadEnv({ path: resolve(backendRoot, '..', '.env') }); // single root .env (docs/14 §4)
  let cfg;
  try {
    cfg = loadBackendConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const deploymentPath = resolve(backendRoot, cfg.DEPLOYMENT_FILE);
  const deployment = loadDeployment(JSON.parse(readFileSync(deploymentPath, 'utf8')));
  if (deployment.chainId !== cfg.CHAIN_ID) {
    console.error(`Deployment ${deploymentPath} is for chain ${deployment.chainId}, CHAIN_ID is ${cfg.CHAIN_ID}`);
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });
  const treasuryConfig = await prisma.treasuryConfig.findFirst({
    where: { treasuryAddress: deployment.contracts.Treasury },
  });
  if (!treasuryConfig) {
    console.error('TreasuryConfig not found — run `pnpm --filter @runwaymind/backend db:seed` first.');
    process.exit(1);
  }

  const chain = new ViemChainService(createChainPublicClient(cfg), {
    treasury: deployment.contracts.Treasury,
    registry: deployment.contracts.ObligationRegistry,
    policy: deployment.contracts.PolicyEngine,
  });

  const { app } = await buildApp({
    prisma,
    chain,
    treasuryId: treasuryConfig.id,
    chainId: cfg.CHAIN_ID,
    appOrigin: cfg.APP_ORIGIN,
    sessionSecret: cfg.SESSION_SECRET,
    production: cfg.NODE_ENV === 'production',
    flags: { agentEnabled: cfg.AGENT_ENABLED, keeperEnabled: cfg.KEEPER_ENABLED, llmEnabled: cfg.LLM_ENABLED },
    logger: { level: cfg.NODE_ENV === 'production' ? 'info' : 'debug' },
  });

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

void main();
