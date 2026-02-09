import bcrypt from 'bcryptjs';
import { localTimestamp } from '../config/index.js';

// ── Constants ────────────────────────────────────────────────

const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

// ── Password hashing ────────────────────────────────────────

/**
 * Hash a password using bcrypt with cost factor 12.
 * OWASP recommendation for password storage.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

// ── Password complexity ─────────────────────────────────────

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate password complexity.
 * Minimum 12 characters, at least 1 uppercase, 1 lowercase, 1 digit, 1 special char.
 */
export function validatePasswordPolicy(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long.');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one digit.');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character.');
  }

  return { valid: errors.length === 0, errors };
}

// ── Account lockout ─────────────────────────────────────────

/**
 * Check if an account is locked based on the locked_until timestamp.
 * Returns { locked, remainingMs }.
 */
export function isAccountLocked(lockedUntil: string | Date | null | undefined): { locked: boolean; remainingMs: number } {
  if (!lockedUntil) return { locked: false, remainingMs: 0 };
  const until = new Date(lockedUntil).getTime();
  const now = Date.now();
  if (until > now) {
    return { locked: true, remainingMs: until - now };
  }
  return { locked: false, remainingMs: 0 };
}

/**
 * Compute lockout state after a failed login.
 * Returns an object suitable for `db('users').update(...)`.
 */
export function computeLockout(currentFailedCount: number): {
  failed_login_count: number;
  locked_until: string | null;
  updated_at: string;
} {
  const newCount = (currentFailedCount ?? 0) + 1;
  const now = new Date().toISOString();

  if (newCount >= MAX_FAILED_LOGINS) {
    const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
    return { failed_login_count: newCount, locked_until: lockUntil, updated_at: now };
  }

  return { failed_login_count: newCount, locked_until: null, updated_at: now };
}

/**
 * Reset lockout state after a successful login.
 * Returns an object suitable for `db('users').update(...)`.
 */
export function resetLockout(): {
  failed_login_count: number;
  locked_until: null;
  updated_at: string;
} {
  return {
    failed_login_count: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  };
}

// Note: ensureAdminUser is in bootstrapAdmin.ts (used by server.ts at startup)
