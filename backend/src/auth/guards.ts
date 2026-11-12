// Authorization levels (docs/07 §2.5): public, session, admin.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbiddenNotAdmin, unauthenticated } from '../errors';
import { SESSION_COOKIE, type AuthService, type Session } from './siwe';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

export function sessionLoader(auth: AuthService) {
  return async (request: FastifyRequest) => {
    request.session = await auth.readSession(request.cookies[SESSION_COOKIE]);
  };
}

export function requireSession() {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.session) throw unauthenticated();
  };
}

/**
 * ADMIN = hasRole(DEFAULT_ADMIN_ROLE) on the Treasury the request targets. Pass the AuthService, or a resolver that
 * picks it per request (multi-treasury: `?treasury=`).
 */
export function requireAdmin(auth: AuthService | ((request: FastifyRequest) => AuthService)) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.session) throw unauthenticated();
    const service = typeof auth === 'function' ? auth(request) : auth;
    if (!(await service.isAdmin(request.session.address))) throw forbiddenNotAdmin();
  };
}
