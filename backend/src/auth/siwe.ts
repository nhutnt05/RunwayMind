// SIWE (EIP-4361) → HTTP-only cookie `rm_session` (JWT HS256, 8 h) — docs/07 §3.1.
// Admin = hasRole(DEFAULT_ADMIN_ROLE, address) on Treasury, cached 60 s (docs/07 §2.5).
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getAddress, type Address, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { ApiError, unauthenticated } from '../errors';
import type { Repositories } from '../repositories';
import type { ChainService } from '../services/chain';

export const SESSION_COOKIE = 'rm_session';
export const SESSION_TTL_SEC = 8 * 60 * 60;
export const NONCE_TTL_SEC = 5 * 60;
export const ROLE_CACHE_MS = 60_000;

export interface Session {
  address: Address;
  expiresAt: number; // Unix seconds (wall clock: session lifetime is operational, not financial)
}

export interface AuthOptions {
  chainId: number;
  appOrigin: string;
  sessionSecret: string;
  now?: () => Date;
}

export function createAuthService(chain: ChainService, repos: Repositories, opts: AuthOptions) {
  const key = new TextEncoder().encode(opts.sessionSecret);
  const now = opts.now ?? (() => new Date());
  const domain = new URL(opts.appOrigin).host;
  const roleCache = new Map<string, { value: boolean; at: number }>();

  async function cachedRole(role: 'ADMIN' | 'AGENT', address: Address): Promise<boolean> {
    const k = `${role}:${address}`;
    const hit = roleCache.get(k);
    const t = now().getTime();
    if (hit && t - hit.at < ROLE_CACHE_MS) return hit.value;
    const value = await chain.hasRole(role, address);
    roleCache.set(k, { value, at: t });
    return value;
  }

  return {
    async issueNonce(): Promise<string> {
      const nonce = randomBytes(16).toString('hex'); // SIWE nonce: alphanumeric, >= 8 chars
      await repos.createNonce(nonce, new Date(now().getTime() + NONCE_TTL_SEC * 1000));
      return nonce;
    },

    async verify(message: string, signature: Hex) {
      const fields = parseSiweMessage(message);
      if (!fields.address || !fields.nonce || !fields.domain) {
        throw new ApiError('VALIDATION_ERROR', 'Malformed SIWE message');
      }
      if (fields.chainId !== opts.chainId) throw new ApiError('UNAUTHENTICATED', `SIWE chainId must be ${opts.chainId}`);
      if (fields.domain !== domain) throw new ApiError('UNAUTHENTICATED', `SIWE domain must be ${domain}`);
      const t = now();
      if (fields.expirationTime && fields.expirationTime.getTime() <= t.getTime()) {
        throw new ApiError('UNAUTHENTICATED', 'SIWE message expired');
      }
      if (!(await chain.verifySiweMessage(message, signature))) {
        throw new ApiError('UNAUTHENTICATED', 'Invalid SIWE signature');
      }
      if (!(await repos.consumeNonce(fields.nonce, t))) {
        throw new ApiError('UNAUTHENTICATED', 'Nonce unknown, expired or already used');
      }
      const address = getAddress(fields.address);
      const [isAdmin, isAgent] = await Promise.all([cachedRole('ADMIN', address), cachedRole('AGENT', address)]);
      await repos.upsertWallet(address, [isAdmin && 'ADMIN', isAgent && 'AGENT'].filter(Boolean) as string[], t);
      await repos.audit('LOGIN', address, { isAdmin, isAgent });
      const expiresAt = Math.floor(t.getTime() / 1000) + SESSION_TTL_SEC;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(address)
        .setIssuedAt(Math.floor(t.getTime() / 1000))
        .setExpirationTime(expiresAt)
        .sign(key);
      return { token, address, isAdmin, isAgent, expiresAt };
    },

    async readSession(token: string | undefined): Promise<Session | null> {
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], currentDate: now() });
        if (!payload.sub || payload.exp === undefined) return null;
        return { address: getAddress(payload.sub), expiresAt: payload.exp };
      } catch {
        return null;
      }
    },

    async me(session: Session | null) {
      if (!session) throw unauthenticated();
      const [isAdmin, isAgent] = await Promise.all([cachedRole('ADMIN', session.address), cachedRole('AGENT', session.address)]);
      return { address: session.address, isAdmin, isAgent, expiresAt: session.expiresAt };
    },

    isAdmin: (address: Address) => cachedRole('ADMIN', address),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
