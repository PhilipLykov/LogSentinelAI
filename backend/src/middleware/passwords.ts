import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
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

// ── Bootstrap admin user ────────────────────────────────────

/**
 * Ensure at least one admin user exists.
 * Uses ADMIN_USERNAME / ADMIN_PASSWORD env vars, or generates credentials.
 */
export async function ensureAdminUser(db: Knex): Promise<void> {
  const existing = await db('users').where({ role: 'administrator' }).first();
  if (existing) return;

  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (password) {
    const passwordHash = await hashPassword(password);
    await db('users').insert({
      id: uuidv4(),
      username,
      password_hash: passwordHash,
      display_name: 'Administrator',
      role: 'administrator',
      is_active: true,
      must_change_password: false,
    });
    console.log(`[${localTimestamp()}] Admin user created from environment: username="${username}"`);
  } else {
    // Generate a random password and print it
    const generatedPassword = randomBytes(16).toString('base64url');
    const passwordHash = await hashPassword(generatedPassword);
    await db('users').insert({
      id: uuidv4(),
      username,
      password_hash: passwordHash,
      display_name: 'Administrator',
      role: 'administrator',
      is_active: true,
      must_change_password: true,
    });

    const border = '─'.repeat(Math.max(generatedPassword.length, username.length) + 32);
    console.log(`[${localTimestamp()}] ┌${border}┐`);
    console.log(`[${localTimestamp()}] │  AUTO-GENERATED ADMIN CREDENTIALS (save them now!)${' '.repeat(Math.max(0, border.length - 52))}  │`);
    console.log(`[${localTimestamp()}] │  Username: ${username}${' '.repeat(Math.max(0, border.length - username.length - 14))}  │`);
    console.log(`[${localTimestamp()}] │  Password: ${generatedPassword}${' '.repeat(Math.max(0, border.length - generatedPassword.length - 14))}  │`);
    console.log(`[${localTimestamp()}] └${border}┘`);
  }
}
