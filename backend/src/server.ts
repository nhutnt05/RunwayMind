// Backend entry point: `pnpm --filter @runwaymind/backend dev` / `node dist/server.js` (docs/11 §5, §10).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import type { Address } from 'viem';
import {
  Executor,
  NonceQueue,
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
import { buildApp, type TreasuryInput } from './app';
import { loadBackendConfig } from './config';
import { createIndexer } from './indexer';
import { createScheduler, failInterruptedExecutions } from './scheduler';
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

  const prisma = new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });
  // Multi-treasury (D6-B1): every TreasuryConfig of this chain is served; primary = isPrimary (seed registers
  // deployment/fuji.json as primary and deployment/fuji-usdc.json as secondary, docs/11 §7.2).
  const rows = await prisma.treasuryConfig.findMany({
    where: { chainId: cfg.CHAIN_ID },
    include: { pools: { orderBy: { addedAt: 'asc' } } },
    orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
  });
  if (rows.length === 0) {
    console.error(`No TreasuryConfig for chain ${cfg.CHAIN_ID} — run \`pnpm --filter @runwaymind/backend db:seed\` first.`);
    process.exit(1);
  }
  // DEPLOYMENT_FILE is only cross-checked: the DB rows (written by the seed from deployment/*.json) are the source.
  try {
    const deployment = loadDeployment(JSON.parse(readFileSync(resolve(backendRoot, cfg.DEPLOYMENT_FILE), 'utf8')));
    if (!rows.some((r) => r.treasuryAddress.toLowerCase() === deployment.contracts.Treasury.toLowerCase())) {
      console.warn(`Treasury of ${cfg.DEPLOYMENT_FILE} is not in the DB — re-run the seed after a redeploy.`);
    }
  } catch {
    /* DEPLOYMENT_FILE missing/invalid: DB rows are authoritative */
  }

  const client = createChainPublicClient(cfg);
  // Signers come only from env (rule 7). A missing key disables that role instead of crashing the API.
  const agentWallet = cfg.AGENT_ENABLED ? createRoleWalletClient(agentCfg, 'AGENT') : null;
  const keeperWallet = cfg.KEEPER_ENABLED ? createRoleWalletClient(agentCfg, 'KEEPER') : null;
  // One nonce queue per signer, shared by every treasury's executor / keeper (same EOA on the same chain).
  const agentQueue = agentWallet ? new NonceQueue(client, agentWallet.account.address) : undefined;
  const keeperQueue = keeperWallet ? new NonceQueue(client, keeperWallet.account.address) : undefined;
  const llmCfg = loadLlmConfig();
  const llmProvider = cfg.LLM_ENABLED && llmCfg.enabled ? createLlmProvider(llmCfg) : null;
  const log = jsonLogger('backend');
  if (cfg.AGENT_ENABLED && !agentWallet) log.warn('AGENT_PRIVATE_KEY unset: recommendations are created but not executed');
  if (cfg.KEEPER_ENABLED && !keeperWallet) log.warn('KEEPER_PRIVATE_KEY unset: keeper loop disabled');

  const treasuries: TreasuryInput[] = rows.map((row) => {
    const addresses = {
      treasury: row.treasuryAddress as Address,
      registry: row.registryAddress as Address,
      policy: row.policyAddress as Address,
    };
    const pool = row.pools.find((p) => p.poolAddress !== '') ?? null;
    const tag = (m: string) => jsonLogger(`${m}:${row.id}`);
    return {
      id: row.id,
      chain: new ViemChainService(client, addresses),
      poolAddress: (pool?.poolAddress as Address | undefined) ?? null,
      scheduler: ({ store, audit, repos }) => {
        let executor: Executor | null = null;
        if (agentWallet) {
          executor = new Executor({ client, wallet: agentWallet, addresses, store, audit, ...(agentQueue ? { queue: agentQueue } : {}), log: tag('executor') });
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
              log: tag('agent'),
            })
          : null;
        const keeper = keeperWallet
          ? createKeeper({ client, wallet: keeperWallet, addresses, store, audit, ...(keeperQueue ? { queue: keeperQueue } : {}), log: tag('keeper') })
          : null;
        const indexer = createIndexer({
          client,
          addresses,
          asset: row.assetAddress as Address,
          repos,
          startBlock: BigInt(row.deployBlock),
          chunkSize: BigInt(cfg.INDEXER_BLOCK_RANGE),
          maxChunksPerPoll: cfg.INDEXER_MAX_CHUNKS_PER_POLL,
          log: tag('indexer'),
        });
        return createScheduler({
          loop,
          executor,
          keeper,
          indexer,
          getSettings: () => repos.agentSettings(),
          approvedDecisionIds: async () => (await repos.listDecisions({ status: 'APPROVED', limit: 100 })).map((d) => d.id),
          recoverInterrupted: (before) => failInterruptedExecutions(store, audit, before),
          getBalance: (address) => client.getBalance({ address }),
          keeperIntervalMs: cfg.KEEPER_INTERVAL_SEC * 1000,
          log: tag('scheduler'),
        });
      },
    };
  });

  const { app, schedulers } = await buildApp({
    prisma,
    treasuries,
    primaryTreasuryId: rows[0]!.id,
    chainId: cfg.CHAIN_ID,
    appOrigin: cfg.APP_ORIGIN,
    sessionSecret: cfg.SESSION_SECRET,
    production: cfg.NODE_ENV === 'production',
    flags: { agentEnabled: cfg.AGENT_ENABLED, keeperEnabled: cfg.KEEPER_ENABLED, llmEnabled: cfg.LLM_ENABLED },
    logger: { level: cfg.NODE_ENV === 'production' ? 'info' : 'debug' },
    agentLog: log,
    llm: { provider: llmProvider, timeoutMs: llmCfg.timeoutMs },
  });
  log.info('serving treasuries', { treasuries: rows.map((r) => r.id), primary: rows[0]!.id });

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  for (const s of schedulers) await s.start();
}

void main();
