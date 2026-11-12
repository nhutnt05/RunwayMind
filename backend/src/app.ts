// Fastify app factory (docs/07 §1). Dependencies are injected so tests can use a fake ChainService.
// Multi-treasury (D6-B1, docs/11 §7.2): one service bundle per TreasuryConfig; every /api/v1 request selects its
// bundle with the optional `?treasury=<id>` query param (default: the primary treasury, unknown id → 404).
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@prisma/client';
import type { Address } from 'viem';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLogger, createApprovalService, type LlmProvider, type Logger } from '@runwaymind/agent';
import { sessionLoader } from './auth/guards';
import { createAuthService, type AuthService } from './auth/siwe';
import { ApiError } from './errors';
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
import { NL_RATE_LIMIT, createNlService, createRateLimiter } from './services/nl';

export const API_PREFIX = '/api/v1';

/** One treasury served by this API (a TreasuryConfig row + its chain access). */
export interface TreasuryInput {
  id: string;
  chain: ChainService;
  /** MockLendingPool of a demo deployment (demo controls, docs/07 §5.7); null when there is none. */
  poolAddress?: Address | null;
  /** Builds this treasury's background scheduler (agent loop, executor, keeper, indexer). */
  scheduler?: (ctx: SchedulerContext) => Scheduler;
}

export interface AppDeps {
  prisma: PrismaClient;
  /** All treasuries; the first one (or `primaryTreasuryId`) is the default. */
  treasuries?: TreasuryInput[];
  primaryTreasuryId?: string;
  /** Single-treasury shorthand (backward compatible): used when `treasuries` is omitted. */
  chain?: ChainService;
  treasuryId?: string;
  poolAddress?: Address | null;
  /**
   * Single-treasury scheduler factory. Omitted in tests that only exercise HTTP; `/agent/evaluate` and `/keeper/run`
   * then return INVALID_STATE.
   */
  scheduler?: (ctx: SchedulerContext) => Scheduler;
  chainId: number;
  appOrigin: string;
  sessionSecret: string;
  production: boolean;
  flags?: { agentEnabled: boolean; keeperEnabled: boolean; llmEnabled: boolean };
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  /** Receipt wait for user-registered transactions (POST /transactions). */
  receiptTimeoutMs?: number;
  /** Structured logger for the agent modules. */
  agentLog?: Logger;
  /** LLM for POST /obligations/parse (docs/05 §6); provider null → 503 LLM_UNAVAILABLE (use the form). */
  llm?: { provider: LlmProvider | null; timeoutMs: number };
  /** Wall clock in ms for the NL rate limiter (tests). */
  nowMs?: () => number;
}

export interface SchedulerContext {
  treasuryId: string;
  repos: Repositories;
  store: PrismaAgentStore;
  audit: AuditLogger;
}

function buildBundle(deps: AppDeps, input: TreasuryInput, nlLimiter: ReturnType<typeof createRateLimiter>) {
  const { chain, id } = input;
  const repos = createRepositories(deps.prisma, id);
  const auth = createAuthService(chain, repos, {
    chainId: deps.chainId,
    appOrigin: deps.appOrigin,
    sessionSecret: deps.sessionSecret,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const store = new PrismaAgentStore(deps.prisma, repos);
  const treasury = createTreasuryService(chain, repos, store);
  const audit = new AuditLogger(store, deps.agentLog);
  const scheduler = input.scheduler ? input.scheduler({ treasuryId: id, repos, store, audit }) : null;
  const approval = createApprovalService({
    store,
    audit,
    executor: scheduler?.executorEnabled ? scheduler : null,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const agent = createAgentService({ repos, approval, audit, scheduler });
  const obligations = createObligationService(chain, repos, deps.chainId);
  const vault = createVaultService({
    chain,
    repos,
    store,
    audit,
    scheduler,
    chainId: deps.chainId,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const admin = createAdminService(chain, deps.chainId, input.poolAddress ?? null);
  const analytics = createAnalyticsService({ chain, prisma: deps.prisma, repos, store, audit });
  const nl = createNlService({
    chain,
    repos,
    audit,
    llm: deps.llm ?? { provider: null, timeoutMs: 8_000 },
    limiter: nlLimiter,
  });
  const transactions = createTransactionService(chain, repos, {
    ...(deps.receiptTimeoutMs !== undefined ? { receiptTimeoutMs: deps.receiptTimeoutMs } : {}),
    ...(deps.agentLog ? { log: deps.agentLog } : {}),
  });
  return { id, chain, repos, store, audit, scheduler, auth, treasury, agent, obligations, vault, admin, analytics, nl, transactions };
}

export type TreasuryBundle = ReturnType<typeof buildBundle>;

declare module 'fastify' {
  interface FastifyRequest {
    treasuryBundle: TreasuryBundle | null;
  }
}

/** The bundle selected for this request (set by the /api/v1 onRequest hook). */
export function bundleOf(request: FastifyRequest): TreasuryBundle {
  if (!request.treasuryBundle) throw new ApiError('INTERNAL_ERROR', 'treasury not resolved');
  return request.treasuryBundle;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const inputs: TreasuryInput[] =
    deps.treasuries ??
    (deps.chain && deps.treasuryId
      ? [
          {
            id: deps.treasuryId,
            chain: deps.chain,
            ...(deps.poolAddress !== undefined ? { poolAddress: deps.poolAddress } : {}),
            ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
          },
        ]
      : []);
  if (inputs.length === 0) throw new Error('buildApp: no treasury configured (treasuries[] or chain + treasuryId)');
  // One NL rate limiter for the whole API: 10/min per wallet regardless of treasury (docs/07 §5.4).
  const nlLimiter = createRateLimiter(NL_RATE_LIMIT.max, NL_RATE_LIMIT.windowMs, deps.nowMs);
  const bundles = new Map(inputs.map((t) => [t.id, buildBundle(deps, t, nlLimiter)] as const));
  const primaryId = deps.primaryTreasuryId && bundles.has(deps.primaryTreasuryId) ? deps.primaryTreasuryId : inputs[0]!.id;
  const primary = bundles.get(primaryId)!;

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
  app.decorateRequest('treasuryBundle', null);
  // Sessions are treasury-independent (same JWT secret, global nonces); role checks use the selected treasury.
  app.addHook('onRequest', sessionLoader(primary.auth));

  /** docs/07 §4 GET /treasuries — configured treasuries, primary first. */
  async function listTreasuries() {
    const rows = await deps.prisma.treasuryConfig.findMany({
      where: { id: { in: [...bundles.keys()] } },
      include: { pools: { orderBy: { addedAt: 'asc' } } },
    });
    rows.sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || a.id.localeCompare(b.id));
    return rows.map((r) => {
      const pool = r.pools.find((p) => p.poolAddress !== '') ?? r.pools[0] ?? null;
      return {
        id: r.id,
        chainId: r.chainId,
        isPrimary: r.id === primaryId,
        treasuryAddress: r.treasuryAddress,
        registryAddress: r.registryAddress,
        policyAddress: r.policyAddress,
        assetAddress: r.assetAddress,
        assetSymbol: r.assetSymbol,
        assetDecimals: r.assetDecimals,
        demoStartTime: r.demoStartTime,
        deployBlock: r.deployBlock,
        poolAddress: pool && pool.poolAddress !== '' ? pool.poolAddress : null,
        adapterAddress: pool?.adapterAddress ?? null,
      };
    });
  }

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (request) => {
        const raw = (request.query as Record<string, unknown> | undefined)?.treasury;
        // `?treasury=a&treasury=b` (array) must not silently fall back to the primary treasury: an admin action
        // would then target a treasury the caller did not ask for.
        if (raw !== undefined && typeof raw !== 'string') {
          throw new ApiError('VALIDATION_ERROR', 'treasury must be a single treasury id', [{ path: 'treasury', issue: 'invalid_type', message: 'expected one string' }]);
        }
        const id = raw !== undefined && raw !== '' ? raw : primaryId;
        const bundle = bundles.get(id);
        if (!bundle) throw new ApiError('NOT_FOUND', `Treasury ${id} not found`);
        request.treasuryBundle = bundle;
      });
      await registerRoutes(api, {
        bundle: bundleOf,
        treasuries: listTreasuries,
        chainId: deps.chainId,
        secureCookies: deps.production,
        flags: deps.flags ?? { agentEnabled: false, keeperEnabled: false, llmEnabled: false },
      });
    },
    { prefix: API_PREFIX },
  );
  const schedulers = [...bundles.values()].map((b) => b.scheduler).filter((s): s is Scheduler => s !== null);
  app.addHook('onClose', async () => {
    for (const s of schedulers) s.stop();
  });
  return {
    app,
    bundles,
    primaryId,
    schedulers,
    // Primary treasury shorthands (backward compatible with single-treasury callers and tests).
    auth: primary.auth,
    scheduler: primary.scheduler,
    store: primary.store,
    services: {
      agent: primary.agent,
      obligations: primary.obligations,
      transactions: primary.transactions,
      treasury: primary.treasury,
      vault: primary.vault,
      admin: primary.admin,
      analytics: primary.analytics,
      nl: primary.nl,
    },
  };
}

export type BuiltApp = Awaited<ReturnType<typeof buildApp>>;
// Keep the AuthService type reachable for callers that destructure `auth`.
export type { AuthService };
