// API errors (docs/07 §2.4). Thrown by services; the error handler turns them into the envelope.
import { redactUrls } from '@runwaymind/agent';
import { API_ERROR_HTTP_STATUS, type ApiErrorCode } from '@runwaymind/shared';

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = API_ERROR_HTTP_STATUS[code];
  }
}

export const notFound = (what: string) => new ApiError('NOT_FOUND', `${what} not found`);
export const unauthenticated = () => new ApiError('UNAUTHENTICATED', 'Sign in with your wallet (SIWE) first');
export const forbiddenNotAdmin = () => new ApiError('FORBIDDEN_NOT_ADMIN', 'Requires ADMIN role (DEFAULT_ADMIN_ROLE)');
// viem error messages embed the request URL (`URL: https://…/<api key>`): never echo it to API clients (rule 7).
export const chainUnavailable = (cause?: unknown) =>
  new ApiError('CHAIN_UNAVAILABLE', 'Blockchain RPC unavailable, try again shortly', cause instanceof Error ? { cause: redactUrls(cause.message) } : undefined);
