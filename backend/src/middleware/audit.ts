import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { localTimestamp } from '../config/index.js';

const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'api_key', 'apikey',
  'authorization', 'key_hash', 'plain_key', 'access_key',
  'private_key', 'credential', 'credentials', 'client_secret',
]);

/**
 * Write an audit log entry.
 * OWASP A09: No secrets in details; log auth and config changes.
 * The `at` column uses DB-level NOW() for correct timestamptz handling.
 */
export async function writeAuditLog(
  db: Knex,
  entry: {
    actor?: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    details?: Record<string, unknown>;
    ip?: string;
  },
): Promise<void> {
  try {
    await db('audit_log').insert({
      id: uuidv4(),
      // Let the DB default (knex.fn.now()) handle timestamptz correctly
      actor: entry.actor ?? null,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id ?? null,
      details: entry.details ? JSON.stringify(sanitizeDetails(entry.details)) : null,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    // Audit logging should never break the main flow
    console.error(`[${localTimestamp()}] Audit log write failed:`, err);
  }
}

/**
 * Recursively remove potentially sensitive fields from audit details (A09).
 */
function sanitizeDetails(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '***REDACTED***';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeDetails(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = sanitizeArray(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeArray(arr: unknown[]): unknown[] {
  return arr.map((item) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return sanitizeDetails(item as Record<string, unknown>);
    }
    if (Array.isArray(item)) {
      return sanitizeArray(item);
    }
    return item;
  });
}
