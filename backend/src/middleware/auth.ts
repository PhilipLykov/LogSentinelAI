import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { findApiKeyByHash } from './apiKeys.js';
import { getDb } from '../db/index.js';
import { localTimestamp } from '../config/index.js';
import type { ApiKeyScope, ApiKeyRow } from '../types/index.js';

const API_KEY_HEADER = 'x-api-key';
const API_KEY_QUERY_PARAM = 'key';

// Fastify type augmentation
declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyRow | null;
  }
}

/**
 * Fastify hook factory: verifies API key from X-API-Key header or ?key= query param.
 * Attaches `request.apiKey` on success.
 *
 * Query param auth is supported for SSE (EventSource doesn't support custom headers).
 * In production, prefer session-based auth or a polyfill for SSE.
 *
 * OWASP: A01 (access control), A07 (auth failures — generic error, rate limited elsewhere).
 */
export function requireAuth(...allowedScopes: ApiKeyScope[]) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Try header first, then query param (for SSE)
    let rawKey = request.headers[API_KEY_HEADER];
    if ((!rawKey || typeof rawKey !== 'string') && (request.query as any)?.[API_KEY_QUERY_PARAM]) {
      rawKey = (request.query as any)[API_KEY_QUERY_PARAM];
    }

    if (!rawKey || typeof rawKey !== 'string') {
      console.log(`[${localTimestamp()}] AUTH_FAIL: missing API key from ${request.ip}`);
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const db = getDb();
    const keyRow = await findApiKeyByHash(db, rawKey);

    if (!keyRow) {
      // Do not reveal whether key exists (A07)
      console.log(`[${localTimestamp()}] AUTH_FAIL: invalid API key from ${request.ip}`);
      return reply.code(401).send({ error: 'Authentication required' });
    }

    if (allowedScopes.length > 0 && !allowedScopes.includes(keyRow.scope)) {
      console.log(
        `[${localTimestamp()}] AUTH_FAIL: scope "${keyRow.scope}" not in [${allowedScopes}] from ${request.ip}`,
      );
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    // Attach key info for downstream handlers
    request.apiKey = keyRow;
  };
}

/** Register auth hooks on a Fastify instance for a route prefix. */
export function registerAuthPlugin(app: FastifyInstance): void {
  // Decorate request so Fastify knows about the property
  app.decorateRequest('apiKey', null);
}
