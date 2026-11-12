// Backend entry point: `pnpm --filter @runwaymind/backend dev` / `node dist/server.js` (docs/11 §5, §10).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import type { Address } from 'viem';
import {
  Executor,
  createAgentLoop,
  createChainPublicClient,
  createKeeper,
  createLlmProvider,
  createRoleWalletClient,
  jsonLogger,
  loadAgentConfig,
  loadLlmConfig,
} from '@runwaymind/agent';
import { loadDeployment } from '@runwaymind/shared';
import { buildApp } from './app';
import { loadBackendConfig } from './config';
import { createIndexer } from './indexer';
import { createScheduler } from './scheduler';
import { ViemChainService } from './services/chain';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');

async function main() {
  loadEnv({ path: resolve(backendRoot, '..', '.env') }); // single root .env (docs/14 §4)
  let cfg;
  let agentCfg;
  try {
    cfg = loadBackendConfig();
    agentCfg = loadAgentConfig();
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

  const client = createChainPublicClient(cfg);
  const addresses = {
    treasury: deployment.contracts.Treasury,
    registry: deployment.contracts.ObligationRegistry,
    policy: deployment.contracts.PolicyEngine,
  };
  const chain = new ViemChainService(client, addresses);

  // Signers come only from env (rule 7). A missing key disables that role instead of crashing the API.
  const agentWallet = cfg.AGENT_ENABLED ? createRoleWalletClient(agentCfg, 'AGENT') : null;
  const keeperWallet = cfg.KEEPER_ENABLED ? createRoleWalletClient(agentCfg, 'KEEPER') : null;
  const llmCfg = loadLlmConfig();
  const llmProvider = cfg.LLM_ENABLED && llmCfg.enabled ? createLlmProvider(llmCfg) : null;
  const log = jsonLogger('backend');
  if (cfg.AGENT_ENABLED && !agentWallet) log.warn('AGENT_PRIVATE_KEY unset: recommendations are created but not executed');
  if (cfg.KEEPER_ENABLED && !keeperWallet) log.warn('KEEPER_PRIVATE_KEY unset: keeper loop disabled');

  const { app, scheduler } = await buildApp({
    prisma,
    chain,
    treasuryId: treasuryConfig.id,
    chainId: cfg.CHAIN_ID,
    appOrigin: cfg.APP_ORIGIN,
    sessionSecret: cfg.SESSION_SECRET,
    production: cfg.NODE_ENV === 'production',
    flags: { agentEnabled: cfg.AGENT_ENABLED, keeperEnabled: cfg.KEEPER_ENABLED, llmEnabled: cfg.LLM_ENABLED },
    logger: { level: cfg.NODE_ENV === 'production' ? 'info' : 'debug' },
    agentLog: log,
    poolAddress: deployment.contracts.MockLendingPool ?? null,
    llm: { provider: llmProvider, timeoutMs: llmCfg.timeoutMs },
    scheduler: ({ store, audit, repos }) => {
      let executor: Executor | null = null;
      if (agentWallet) {
        executor = new Executor({ client, wallet: agentWallet, addresses, store, audit, log: jsonLogger('executor') });
      }
      const loop = cfg.AGENT_ENABLED
        ? createAgentLoop({
            client,
            addresses,
            store,
            audit,
            agentAccount: agentWallet?.account.address ?? null,
            executor,
            llm: { provider: llmProvider, timeoutMs: llmCfg.timeoutMs },
            log: jsonLogger('agent'),
          })
        : null;
      const keeper = keeperWallet
        ? createKeeper({ client, wallet: keeperWallet, addresses, store, audit, log: jsonLogger('keeper') })
        : null;
      const indexer = createIndexer({
        client,
        addresses,
        asset: treasuryConfig.assetAddress as Address,
        repos,
        startBlock: BigInt(treasuryConfig.deployBlock),
        chunkSize: BigInt(cfg.INDEXER_BLOCK_RANGE),
        maxChunksPerPoll: cfg.INDEXER_MAX_CHUNKS_PER_POLL,
        log: jsonLogger('indexer'),
      });
      return createScheduler({
        loop,
        executor,
        keeper,
        indexer,
        getSettings: () => repos.agentSettings(),
        approvedDecisionIds: async () => (await repos.listDecisions({ status: 'APPROVED', limit: 100 })).map((d) => d.id),
        getBalance: (address) => client.getBalance({ address }),
        keeperIntervalMs: cfg.KEEPER_INTERVAL_SEC * 1000,
        log: jsonLogger('scheduler'),
      });
    },
  });

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  await scheduler?.start();
}

void main();
