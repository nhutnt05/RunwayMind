// Response envelope + error handler (docs/07 §2.1–§2.4). Amounts are never JSON numbers: data passes toJsonSafe.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { toJsonSafe, type ApiFailure, type ApiMeta } from '@runwaymind/shared';
import { redactUrls } from '@runwaymind/agent';
import { ApiError } from '../errors';

export interface ChainMeta {
  chainTime?: number;
  blockNumber?: bigint | string;
  nextCursor?: string | null;
}

export function ok<T>(request: FastifyRequest, data: T, chain: ChainMeta = {}) {
  const meta: ApiMeta = { requestId: request.id };
  if (chain.chainTime !== undefined) meta.chainTime = chain.chainTime;
  if (chain.blockNumber !== undefined) meta.blockNumber = chain.blockNumber.toString();
  if (chain.nextCursor !== undefined) meta.nextCursor = chain.nextCursor;
  return { success: true as const, data: toJsonSafe(data), error: null, meta };
}

function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), issue: i.code, message: i.message }));
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    let body: ApiFailure;
    const meta = { requestId: request.id };
    if (error instanceof ApiError) {
      body = { success: false, data: null, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details as never } : {}) }, meta };
      return reply.status(error.statusCode).send(body);
    }
    const validation = (error as FastifyError).validation;
    if (error instanceof ZodError || validation || (error as FastifyError).code === 'FST_ERR_VALIDATION') {
      const details =
        error instanceof ZodError
          ? zodDetails(error)
          : (validation ?? []).map((v) => ({ path: v.instancePath.replace(/^\//, '').replace(/\//g, '.') || String(v.params?.missingProperty ?? ''), issue: v.keyword, message: v.message }));
      body = { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: error.message, details }, meta };
      return reply.status(400).send(body);
    }
    const status = (error as FastifyError).statusCode;
    if (status === 429) {
      body = { success: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests' }, meta };
      return reply.status(429).send(body);
    }
    // Logged without the raw error object: viem messages/stacks embed RPC URLs with API keys (rule 7).
    const err = error as Error;
    request.log.error({ err: { type: err.name, message: redactUrls(err.message ?? ''), stack: redactUrls(err.stack ?? '') } }, 'unhandled error');
    body = { success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, meta };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiFailure = {
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
      meta: { requestId: request.id },
    };
    return reply.status(404).send(body);
  });
}
