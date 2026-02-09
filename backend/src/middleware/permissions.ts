/**
 * Granular permission constants and role-to-permission mappings.
 *
 * Permissions follow the pattern `resource:action`.
 * Roles map to a set of permissions they are granted.
 *
 * API keys map their legacy scope to a permission set so
 * they can coexist with the new user-based auth.
 */

// ── Permission constants ─────────────────────────────────────

export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',

  // Events
  EVENTS_VIEW: 'events:view',
  EVENTS_ACKNOWLEDGE: 'events:acknowledge',

  // Systems & Sources
  SYSTEMS_VIEW: 'systems:view',
  SYSTEMS_MANAGE: 'systems:manage',

  // AI Configuration
  AI_CONFIG_VIEW: 'ai_config:view',
  AI_CONFIG_MANAGE: 'ai_config:manage',

  // Notifications
  NOTIFICATIONS_VIEW: 'notifications:view',
  NOTIFICATIONS_MANAGE: 'notifications:manage',

  // Database Maintenance
  DATABASE_VIEW: 'database:view',
  DATABASE_MANAGE: 'database:manage',

  // Privacy
  PRIVACY_VIEW: 'privacy:view',
  PRIVACY_MANAGE: 'privacy:manage',

  // User Management
  USERS_MANAGE: 'users:manage',

  // API Key Management
  API_KEYS_MANAGE: 'api_keys:manage',

  // Audit Log
  AUDIT_VIEW: 'audit:view',
  AUDIT_EXPORT: 'audit:export',

  // RAG / Ask AI
  RAG_USE: 'rag:use',

  // AI Usage / Costs
  AI_USAGE_VIEW: 'ai_usage:view',

  // Compliance Export
  COMPLIANCE_EXPORT: 'compliance:export',

  // Ingest (API key only)
  INGEST: 'ingest',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// ── User roles ───────────────────────────────────────────────

export type UserRole = 'administrator' | 'auditor' | 'monitoring_agent';

export const USER_ROLES: readonly UserRole[] = ['administrator', 'auditor', 'monitoring_agent'] as const;

// ── Role → Permission mapping ────────────────────────────────

const P = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  administrator: new Set<Permission>([
    P.DASHBOARD_VIEW,
    P.EVENTS_VIEW,
    P.EVENTS_ACKNOWLEDGE,
    P.SYSTEMS_VIEW,
    P.SYSTEMS_MANAGE,
    P.AI_CONFIG_VIEW,
    P.AI_CONFIG_MANAGE,
    P.NOTIFICATIONS_VIEW,
    P.NOTIFICATIONS_MANAGE,
    P.DATABASE_VIEW,
    P.DATABASE_MANAGE,
    P.PRIVACY_VIEW,
    P.PRIVACY_MANAGE,
    P.USERS_MANAGE,
    P.API_KEYS_MANAGE,
    P.AUDIT_VIEW,
    P.AUDIT_EXPORT,
    P.RAG_USE,
    P.AI_USAGE_VIEW,
    P.COMPLIANCE_EXPORT,
    // Note: INGEST is API-key-only, not user-session based
  ]),

  auditor: new Set<Permission>([
    P.DASHBOARD_VIEW,
    P.EVENTS_VIEW,
    // No EVENTS_ACKNOWLEDGE
    P.SYSTEMS_VIEW,
    // No SYSTEMS_MANAGE
    P.AI_CONFIG_VIEW,
    // No AI_CONFIG_MANAGE
    P.NOTIFICATIONS_VIEW,
    // No NOTIFICATIONS_MANAGE
    P.DATABASE_VIEW,
    // No DATABASE_MANAGE
    P.PRIVACY_VIEW,
    // No PRIVACY_MANAGE
    // No USERS_MANAGE
    // No API_KEYS_MANAGE
    P.AUDIT_VIEW,
    P.AUDIT_EXPORT,
    P.RAG_USE,
    P.AI_USAGE_VIEW,
    P.COMPLIANCE_EXPORT,
  ]),

  monitoring_agent: new Set<Permission>([
    P.DASHBOARD_VIEW,
    P.EVENTS_VIEW,
    P.EVENTS_ACKNOWLEDGE,
    P.SYSTEMS_VIEW,
    // No SYSTEMS_MANAGE
    // No AI_CONFIG_*
    // No NOTIFICATIONS_*
    // No DATABASE_*
    // No PRIVACY_*
    // No USERS_MANAGE
    // No API_KEYS_MANAGE
    // No AUDIT_*
    P.RAG_USE,
    P.AI_USAGE_VIEW,
    // No COMPLIANCE_EXPORT
  ]),
};

// ── API key scope → Permission mapping ───────────────────────
// Backward compatibility: map legacy scopes to permissions

export const API_KEY_SCOPE_PERMISSIONS: Record<string, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    P.DASHBOARD_VIEW,
    P.EVENTS_VIEW,
    P.EVENTS_ACKNOWLEDGE,
    P.SYSTEMS_VIEW,
    P.SYSTEMS_MANAGE,
    P.AI_CONFIG_VIEW,
    P.AI_CONFIG_MANAGE,
    P.NOTIFICATIONS_VIEW,
    P.NOTIFICATIONS_MANAGE,
    P.DATABASE_VIEW,
    P.DATABASE_MANAGE,
    P.PRIVACY_VIEW,
    P.PRIVACY_MANAGE,
    P.USERS_MANAGE,
    P.API_KEYS_MANAGE,
    P.AUDIT_VIEW,
    P.RAG_USE,
    P.AI_USAGE_VIEW,
    P.COMPLIANCE_EXPORT,
    P.INGEST,
  ]),

  ingest: new Set<Permission>([
    P.INGEST,
  ]),

  read: new Set<Permission>([
    P.DASHBOARD_VIEW,
    P.EVENTS_VIEW,
    P.SYSTEMS_VIEW,
    P.RAG_USE,
    P.AI_USAGE_VIEW,
  ]),

  dashboard: new Set<Permission>([
    P.DASHBOARD_VIEW,
    P.EVENTS_VIEW,
    P.SYSTEMS_VIEW,
    P.RAG_USE,
    P.AI_USAGE_VIEW,
  ]),
};

/**
 * Check if a set of granted permissions includes the required permission.
 */
export function hasPermission(
  granted: ReadonlySet<Permission>,
  required: Permission,
): boolean {
  return granted.has(required);
}

/**
 * Get the permission set for a user role.
 */
export function getPermissionsForRole(role: UserRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role] ?? new Set();
}

/**
 * Get the permission set for an API key scope.
 */
export function getPermissionsForScope(scope: string): ReadonlySet<Permission> {
  return API_KEY_SCOPE_PERMISSIONS[scope] ?? new Set();
}
