// Fastify app factory (docs/07 §1). Dependencies are injected so tests can use a fake ChainService.
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sessionLoader } from './auth/guards';
import { createAuthService, type AuthService } from './auth/siwe';
import { registerErrorHandling } from './plugins/envelope';
import { createRepositories } from './repositories';
import { registerRoutes } from './routes';
import type { ChainService } from './services/chain';
import { createTreasuryService } from './services/treasury';

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
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; auth: AuthService }> {
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
  const treasury = createTreasuryService(deps.chain, repos);

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
        chainId: deps.chainId,
        secureCookies: deps.production,
        flags: deps.flags ?? { agentEnabled: false, keeperEnabled: false, llmEnabled: false },
      }),
    { prefix: API_PREFIX },
  );
  return { app, auth };
}
