// Route registration under /api/v1 (docs/07 §3–§5.3). Routes validate input and call services only.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentSettingsUpdateSchema,
  AuthVerifyRequestSchema,
  CashLadderQuerySchema,
  CreateInflowRequestSchema,
  CreateObligationRequestSchema,
  DemoPrepareRequestSchema,
  PaginationQuerySchema,
  ParseObligationsRequestSchema,
  PolicyPrepareRequestSchema,
  RegisterTransactionRequestSchema,
  RejectRecommendationRequestSchema,
  StressTestRequestSchema,
  TransactionKindSchema,
  TxHashSchema,
  UpdateObligationRequestSchema,
  VaultInvestmentRequestSchema,
  VaultWithdrawalRequestSchema,
} from '@runwaymind/shared';
import type { Address, Hex } from 'viem';
import { requireAdmin, requireSession } from '../auth/guards';
import { SESSION_COOKIE, SESSION_TTL_SEC } from '../auth/siwe';
import type { TreasuryBundle } from '../app';
import type { FastifyRequest } from 'fastify';
import { ok } from '../plugins/envelope';

export interface RouteDeps {
  /** Service bundle of the treasury selected by `?treasury=` (default primary; resolved in an onRequest hook). */
  bundle: (request: FastifyRequest) => TreasuryBundle;
  /** GET /treasuries payload. */
  treasuries: () => Promise<unknown[]>;
  chainId: number;
  secureCookies: boolean;
  flags: { agentEnabled: boolean; keeperEnabled: boolean; llmEnabled: boolean };
}

const AddressParamSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'adapter must be an address');
const ObligationIdParams = z.object({ id: z.string().regex(/^[1-9]\d*$/, 'id must be a positive integer') });
const ObligationsQuery = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'ALL']).default('ALL'),
});
const DecisionStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'EXECUTING',
  'EXECUTED',
  'BLOCKED_BY_POLICY',
  'FAILED',
]);
const RecommendationsQuery = z.object({
  status: DecisionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const IdParams = z.object({ id: z.string().min(1).max(100) });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const TransactionsQuery = PaginationQuerySchema.extend({
  kind: TransactionKindSchema.optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'REVERTED', 'FAILED', 'DROPPED']).optional(),
});
const HashParams = z.object({ hash: TxHashSchema });
const AuditLogsQuery = z.object({
  entityType: z.string().min(1).max(32).optional(),
  entityId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const b = deps.bundle;
  const admin = requireAdmin((request) => b(request).auth);
  /** Session wallet; only called behind requireSession / requireAdmin. */
  const caller = (request: { session: { address: string } | null }) => request.session!.address as Address;

  // ---- §3 health -------------------------------------------------------------------------------------------------
  api.get('/health', { schema: { tags: ['health'] } }, async (request) => {
    const blockNumber = await b(request).chain.getBlockNumber();
    return ok(
      request,
      { status: 'ok', chainId: deps.chainId, blockNumber, ...deps.flags },
      { blockNumber },
    );
  });

  // ---- D6-B1 treasuries (multi-treasury, docs/11 §7.2) ---------------------------------------------------------
  api.get('/treasuries', { schema: { tags: ['treasury'] } }, async (request) => ok(request, await deps.treasuries()));

  // ---- §3.1 auth -------------------------------------------------------------------------------------------------
  api.post('/auth/nonce', { schema: { tags: ['auth'] } }, async (request) => ok(request, { nonce: await b(request).auth.issueNonce() }));

  api.post('/auth/verify', { schema: { tags: ['auth'], body: AuthVerifyRequestSchema } }, async (request, reply) => {
    const res = await b(request).auth.verify(request.body.message, request.body.signature as Hex);
    reply.setCookie(SESSION_COOKIE, res.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: deps.secureCookies,
      maxAge: SESSION_TTL_SEC,
    });
    return ok(request, { address: res.address, isAdmin: res.isAdmin, isAgent: res.isAgent });
  });

  api.get('/auth/me', { schema: { tags: ['auth'] }, preHandler: requireSession() }, async (request) =>
    ok(request, await b(request).auth.me(request.session)),
  );

  api.post('/auth/logout', { schema: { tags: ['auth'] }, preHandler: requireSession() }, async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return ok(request, { loggedOut: true });
  });

  // ---- §4.1 overview ---------------------------------------------------------------------------------------------
  api.get('/treasury/overview', { schema: { tags: ['treasury'] } }, async (request) => {
    const r = await b(request).treasury.overview();
    return ok(request, r.data, r);
  });

  // ---- §4.2 obligations ------------------------------------------------------------------------------------------
  api.get('/obligations', { schema: { tags: ['obligations'], querystring: ObligationsQuery } }, async (request) => {
    const r = await b(request).treasury.listObligations(request.query.status);
    return ok(request, r.data, r);
  });

  api.get('/obligations/:id', { schema: { tags: ['obligations'], params: ObligationIdParams } }, async (request) => {
    const r = await b(request).treasury.getObligation(BigInt(request.params.id));
    return ok(request, r.data, r);
  });

  // ---- §4.3 cash ladder ------------------------------------------------------------------------------------------
  api.get('/cash-ladder', { schema: { tags: ['cash-ladder'], querystring: CashLadderQuerySchema } }, async (request) => {
    const r = await b(request).treasury.cashLadder({
      projectionDays: request.query.projectionDays,
      includeProjectedYield: request.query.includeYield,
    });
    return ok(request, r.data, r);
  });

  api.get('/cash-ladder/withdrawal-schedule', { schema: { tags: ['cash-ladder'] } }, async (request) => {
    const r = await b(request).treasury.withdrawalSchedule();
    return ok(request, r.data, r);
  });

  // ---- §4.4 pools / Pool Risk ------------------------------------------------------------------------------------
  const AdapterParams = z.object({ adapter: AddressParamSchema });
  api.get('/pools', { schema: { tags: ['pools'] } }, async (request) => {
    const r = await b(request).analytics.listPools();
    return ok(request, r.data, r);
  });

  api.get('/pools/:adapter', { schema: { tags: ['pools'], params: AdapterParams } }, async (request) => {
    const r = await b(request).analytics.getPool(request.params.adapter as Address);
    return ok(request, r.data, r);
  });

  api.get('/pools/:adapter/risk', { schema: { tags: ['pools'], params: AdapterParams } }, async (request) => {
    const r = await b(request).analytics.getPoolRisk(request.params.adapter as Address);
    return ok(request, r.data, r);
  });

  // ---- §4.5 runway + stress tests ---------------------------------------------------------------------------------
  api.get('/runway', { schema: { tags: ['stress'] } }, async (request) => {
    const r = await b(request).analytics.runway();
    return ok(request, r.data, r);
  });

  api.post(
    '/stress-tests',
    { schema: { tags: ['stress'], body: StressTestRequestSchema.optional() }, preHandler: requireSession() },
    async (request) => {
      const r = await b(request).analytics.runStressTests(request.body?.scenarios, caller(request));
      return ok(request, r.data, r);
    },
  );

  api.get('/stress-tests', { schema: { tags: ['stress'], querystring: LimitQuery } }, async (request) =>
    ok(request, await b(request).analytics.listStressTests(request.query.limit)),
  );

  api.get('/stress-tests/:id', { schema: { tags: ['stress'], params: IdParams } }, async (request) =>
    ok(request, await b(request).analytics.getStressTest(request.params.id)),
  );

  // ---- §4.6 expected inflows (A-09) -------------------------------------------------------------------------------
  api.get('/inflows', { schema: { tags: ['inflows'] } }, async (request) => ok(request, await b(request).analytics.listInflows()));

  api.post(
    '/inflows',
    { schema: { tags: ['inflows'], body: CreateInflowRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).analytics.createInflow(request.body, caller(request))),
  );

  api.delete('/inflows/:id', { schema: { tags: ['inflows'], params: IdParams }, preHandler: admin }, async (request) =>
    ok(request, await b(request).analytics.deleteInflow(request.params.id)),
  );

  // ---- §5.4 natural-language obligation parsing (admin, 10/min) ---------------------------------------------------
  api.post(
    '/obligations/parse',
    { schema: { tags: ['obligations'], body: ParseObligationsRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).nl.parse(request.body, caller(request))),
  );

  // ---- §5.1–§5.3 obligation writes (prepared ADMIN transactions) -------------------------------------------------
  api.post(
    '/obligations',
    { schema: { tags: ['obligations'], body: CreateObligationRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).obligations.prepareCreate(request.body, caller(request))),
  );

  api.patch(
    '/obligations/:id',
    { schema: { tags: ['obligations'], params: ObligationIdParams, body: UpdateObligationRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).obligations.prepareUpdate(BigInt(request.params.id), request.body, caller(request))),
  );

  api.post(
    '/obligations/:id/cancel',
    { schema: { tags: ['obligations'], params: ObligationIdParams }, preHandler: admin },
    async (request) => ok(request, await b(request).obligations.prepareCancel(BigInt(request.params.id), caller(request))),
  );

  // ---- §4.7 recommendations, agent, keeper -----------------------------------------------------------------------
  api.get('/recommendations', { schema: { tags: ['agent'], querystring: RecommendationsQuery } }, async (request) =>
    ok(request, await b(request).agent.listRecommendations(request.query)),
  );

  api.get('/recommendations/:id', { schema: { tags: ['agent'], params: IdParams } }, async (request) =>
    ok(request, await b(request).agent.getRecommendation(request.params.id)),
  );

  api.post(
    '/recommendations/:id/approve',
    { schema: { tags: ['agent'], params: IdParams }, preHandler: admin },
    async (request) => ok(request, await b(request).agent.approve(request.params.id, caller(request))),
  );

  api.post(
    '/recommendations/:id/reject',
    { schema: { tags: ['agent'], params: IdParams, body: RejectRecommendationRequestSchema.optional() }, preHandler: admin },
    async (request) => ok(request, await b(request).agent.reject(request.params.id, caller(request), request.body?.reason)),
  );

  api.post('/agent/evaluate', { schema: { tags: ['agent'] }, preHandler: admin }, async (request) =>
    ok(request, await b(request).agent.evaluate()),
  );

  api.get('/agent/settings', { schema: { tags: ['agent'] } }, async (request) => ok(request, await b(request).agent.getSettings()));

  api.put(
    '/agent/settings',
    { schema: { tags: ['agent'], body: AgentSettingsUpdateSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).agent.updateSettings(request.body, caller(request))),
  );

  api.get('/agent/activity', { schema: { tags: ['agent'], querystring: LimitQuery } }, async (request) =>
    ok(request, await b(request).agent.activity(request.query.limit)),
  );

  api.get('/keeper/status', { schema: { tags: ['keeper'] } }, async (request) => ok(request, await b(request).agent.keeperStatus()));

  api.post('/keeper/run', { schema: { tags: ['keeper'] }, preHandler: admin }, async (request) =>
    ok(request, await b(request).agent.runKeeper()),
  );

  // ---- §5.5–§5.7 vault actions, policy & demo helpers (admin) ---------------------------------------------------
  api.post(
    '/vault/withdrawals',
    { schema: { tags: ['vault'], body: VaultWithdrawalRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).vault.withdraw(request.body, caller(request))),
  );

  api.post(
    '/vault/investments',
    { schema: { tags: ['vault'], body: VaultInvestmentRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).vault.invest(request.body, caller(request))),
  );

  api.post(
    '/policy/prepare',
    { schema: { tags: ['policy'], body: PolicyPrepareRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).admin.preparePolicy(request.body, caller(request))),
  );

  api.post(
    '/demo/prepare',
    { schema: { tags: ['demo'], body: DemoPrepareRequestSchema }, preHandler: admin },
    async (request) => ok(request, await b(request).admin.prepareDemo(request.body, caller(request))),
  );

  // ---- §4.8 transactions and audit -------------------------------------------------------------------------------
  api.get('/transactions', { schema: { tags: ['transactions'], querystring: TransactionsQuery } }, async (request) => {
    const page = await b(request).transactions.list(request.query);
    return ok(request, page.items, { nextCursor: page.nextCursor });
  });

  api.post(
    '/transactions',
    { schema: { tags: ['transactions'], body: RegisterTransactionRequestSchema }, preHandler: requireSession() },
    async (request) => {
      const { tx } = await b(request).transactions.register(
        { txHash: request.body.txHash.toLowerCase() as Hex, kind: request.body.kind, relatedDraftId: request.body.relatedDraftId },
        caller(request),
      );
      return ok(request, tx);
    },
  );

  api.get('/transactions/:hash', { schema: { tags: ['transactions'], params: HashParams } }, async (request) =>
    ok(request, await b(request).transactions.get(request.params.hash.toLowerCase())),
  );

  api.get('/audit-logs', { schema: { tags: ['audit'], querystring: AuditLogsQuery } }, async (request) =>
    ok(request, await b(request).transactions.auditLogs(request.query)),
  );
}
