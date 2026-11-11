// Route registration under /api/v1 (docs/07 §3–§4.3). Routes validate input and call services only.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuthVerifyRequestSchema, CashLadderQuerySchema } from '@runwaymind/shared';
import type { Hex } from 'viem';
import { requireSession } from '../auth/guards';
import { SESSION_COOKIE, SESSION_TTL_SEC, type AuthService } from '../auth/siwe';
import { ok } from '../plugins/envelope';
import type { ChainService } from '../services/chain';
import type { TreasuryService } from '../services/treasury';

export interface RouteDeps {
  chain: ChainService;
  auth: AuthService;
  treasury: TreasuryService;
  chainId: number;
  secureCookies: boolean;
  flags: { agentEnabled: boolean; keeperEnabled: boolean; llmEnabled: boolean };
}

const ObligationIdParams = z.object({ id: z.string().regex(/^[1-9]\d*$/, 'id must be a positive integer') });
const ObligationsQuery = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'ALL']).default('ALL'),
});

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { auth, treasury, chain } = deps;

  // ---- §3 health -------------------------------------------------------------------------------------------------
  api.get('/health', { schema: { tags: ['health'] } }, async (request) => {
    const blockNumber = await chain.getBlockNumber();
    return ok(
      request,
      { status: 'ok', chainId: deps.chainId, blockNumber, ...deps.flags },
      { blockNumber },
    );
  });

  // ---- §3.1 auth -------------------------------------------------------------------------------------------------
  api.post('/auth/nonce', { schema: { tags: ['auth'] } }, async (request) => ok(request, { nonce: await auth.issueNonce() }));

  api.post('/auth/verify', { schema: { tags: ['auth'], body: AuthVerifyRequestSchema } }, async (request, reply) => {
    const res = await auth.verify(request.body.message, request.body.signature as Hex);
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
    ok(request, await auth.me(request.session)),
  );

  api.post('/auth/logout', { schema: { tags: ['auth'] }, preHandler: requireSession() }, async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return ok(request, { loggedOut: true });
  });

  // ---- §4.1 overview ---------------------------------------------------------------------------------------------
  api.get('/treasury/overview', { schema: { tags: ['treasury'] } }, async (request) => {
    const r = await treasury.overview();
    return ok(request, r.data, r);
  });

  // ---- §4.2 obligations ------------------------------------------------------------------------------------------
  api.get('/obligations', { schema: { tags: ['obligations'], querystring: ObligationsQuery } }, async (request) => {
    const r = await treasury.listObligations(request.query.status);
    return ok(request, r.data, r);
  });

  api.get('/obligations/:id', { schema: { tags: ['obligations'], params: ObligationIdParams } }, async (request) => {
    const r = await treasury.getObligation(BigInt(request.params.id));
    return ok(request, r.data, r);
  });

  // ---- §4.3 cash ladder ------------------------------------------------------------------------------------------
  api.get('/cash-ladder', { schema: { tags: ['cash-ladder'], querystring: CashLadderQuerySchema } }, async (request) => {
    const r = await treasury.cashLadder({
      projectionDays: request.query.projectionDays,
      includeProjectedYield: request.query.includeYield,
    });
    return ok(request, r.data, r);
  });

  api.get('/cash-ladder/withdrawal-schedule', { schema: { tags: ['cash-ladder'] } }, async (request) => {
    const r = await treasury.withdrawalSchedule();
    return ok(request, r.data, r);
  });
}
