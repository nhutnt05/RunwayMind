// Fastify app factory (docs/07 §1). Dependencies are injected so tests can use a fake ChainService.
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@prisma/client';
import type { Address } from 'viem';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLogger, createApprovalService, type LlmProvider, type Logger } from '@runwaymind/agent';
import { sessionLoader } from './auth/guards';
import { createAuthService, type AuthService } from './auth/siwe';
import { registerErrorHandling } from './plugins/envelope';
import { createRepositories, type Repositories } from './repositories';
import { PrismaAgentStore } from './repositories/agentStore';
import { registerRoutes } from './routes';
import type { Scheduler } from './scheduler';
import { createAdminService } from './services/admin';
import { createAnalyticsService } from './services/analytics';
import { createAgentService } from './services/agent';
import type { ChainService } from './services/chain';
import { createObligationService } from './services/obligations';
import { createTransactionService } from './services/transactions';
import { createTreasuryService } from './services/treasury';
import { createVaultService } from './services/vault';
import { createNlService } from './services/nl';

export const API_PREFIX = '/api/v1';

export interface AppDeps {
  prisma: PrismaClient;
  chain: ChainService;
  treasuryId: string;
  chainId: number;
  appOrigin: string;
  sessionSecret: string;
  production: boolean;
  flags?: { agentEnabled: boolean; keeperEnabled: boolean; llmEnabled: boolean };
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  /**
   * Builds the background scheduler (agent loop, executor, keeper, indexer) on the app's store and audit logger.
   * Omitted in tests that only exercise HTTP; `/agent/evaluate` and `/keeper/run` then return INVALID_STATE.
   */
  scheduler?: (ctx: SchedulerContext) => Scheduler;
  /** Receipt wait for user-registered transactions (POST /transactions). */
  receiptTimeoutMs?: number;
  /** Structured logger for the agent modules. */
  agentLog?: Logger;
  /** MockLendingPool of a demo deployment (demo controls, docs/07 §5.7); null/omitted when the deployment has none. */
  poolAddress?: Address | null;
  /** LLM for POST /obligations/parse (docs/05 §6); provider null → 503 LLM_UNAVAILABLE (use the form). */
  llm?: { provider: LlmProvider | null; timeoutMs: number };
  /** Wall clock in ms for the NL rate limiter (tests). */
  nowMs?: () => number;
}

export interface SchedulerContext {
  repos: Repositories;
  store: PrismaAgentStore;
  audit: AuditLogger;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const repos = createRepositories(deps.prisma, deps.treasuryId);
  const auth = createAuthService(deps.chain, repos, {
    chainId: deps.chainId,
    appOrigin: deps.appOrigin,
    sessionSecret: deps.sessionSecret,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const store = new PrismaAgentStore(deps.prisma, repos);
  const treasury = createTreasuryService(deps.chain, repos, store);
  const audit = new AuditLogger(store, deps.agentLog);
  const scheduler = deps.scheduler ? deps.scheduler({ repos, store, audit }) : null;
  const approval = createApprovalService({
    store,
    audit,
    executor: scheduler?.executorEnabled ? scheduler : null,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const agent = createAgentService({ repos, approval, audit, scheduler });
  const obligations = createObligationService(deps.chain, repos, deps.chainId);
  const vault = createVaultService({
    chain: deps.chain,
    repos,
    store,
    audit,
    scheduler,
    chainId: deps.chainId,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const admin = createAdminService(deps.chain, deps.chainId, deps.poolAddress ?? null);
  const analytics = createAnalyticsService({ chain: deps.chain, prisma: deps.prisma, repos, store, audit });
  const nl = createNlService({
    chain: deps.chain,
    repos,
    audit,
    llm: deps.llm ?? { provider: null, timeoutMs: 8_000 },
    ...(deps.nowMs ? { now: deps.nowMs } : {}),
  });
  const transactions = createTransactionService(deps.chain, repos, {
    ...(deps.receiptTimeoutMs !== undefined ? { receiptTimeoutMs: deps.receiptTimeoutMs } : {}),
    ...(deps.agentLog ? { log: deps.agentLog } : {}),
  });

  await app.register(cookie);
  await app.register(cors, { origin: deps.appOrigin, credentials: true });
  await app.register(swagger, {
    openapi: {
      info: { title: 'RunwayMind API', version: '1.0.0', description: 'docs/07 — amounts are base-unit strings' },
      servers: [{ url: API_PREFIX }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: `${API_PREFIX}/docs` });

  app.decorateRequest('session', null);
  app.addHook('onRequest', sessionLoader(auth));

  await app.register(
    async (api) =>
      registerRoutes(api, {
        chain: deps.chain,
        auth,
        treasury,
        obligations,
        transactions,
        agent,
        vault,
        admin,
        analytics,
        nl,
        chainId: deps.chainId,
        secureCookies: deps.production,
        flags: deps.flags ?? { agentEnabled: false, keeperEnabled: false, llmEnabled: false },
      }),
    { prefix: API_PREFIX },
  );
  app.addHook('onClose', async () => scheduler?.stop());
  return { app, auth, scheduler, store, services: { agent, obligations, transactions, treasury, vault, admin, analytics, nl } };
}

export type BuiltApp = Awaited<ReturnType<typeof buildApp>>;
// Keep the AuthService type reachable for callers that destructure `auth`.
export type { AuthService };
