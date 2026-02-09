/**
 * Bootstrap the first administrator user.
 *
 * If no users exist in the database:
 * - If ADMIN_USERNAME / ADMIN_PASSWORD env vars are set, create the admin from those.
 * - Otherwise generate a random password and print it to the console.
 */

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { localTimestamp } from '../config/index.js';
import { hashPassword } from './passwords.js';

export async function ensureAdminUser(db: Knex): Promise<void> {
  // Only attempt if users table exists
  try {
    const exists = await db.schema.hasTable('users');
    if (!exists) return;
  } catch {
    return;
  }

  const existing = await db('users').first();
  if (existing) return; // Users already exist

  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;

  let password: string;
  if (envPassword && envPassword.length >= 12) {
    password = envPassword;
  } else {
    // Generate a strong random password
    password = randomBytes(16).toString('base64url').slice(0, 20) + '!A1a';
  }

  const id = uuidv4();
  const passwordHash = await hashPassword(password);

  await db('users').insert({
    id,
    username,
    password_hash: passwordHash,
    display_name: 'Administrator',
    role: 'administrator',
    is_active: true,
    must_change_password: !envPassword, // Force change if auto-generated
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (!envPassword || envPassword.length < 12) {
    const border = '─'.repeat(Math.max(password.length, username.length) + 8);
    console.log(`[${localTimestamp()}] ┌${border}┐`);
    console.log(`[${localTimestamp()}] │  BOOTSTRAP ADMIN ACCOUNT (save these credentials!):${' '.repeat(Math.max(0, border.length - 52))}│`);
    console.log(`[${localTimestamp()}] │  Username: ${username}${' '.repeat(Math.max(0, border.length - username.length - 14))}│`);
    console.log(`[${localTimestamp()}] │  Password: ${password}${' '.repeat(Math.max(0, border.length - password.length - 14))}│`);
    console.log(`[${localTimestamp()}] └${border}┘`);
  } else {
    console.log(`[${localTimestamp()}] Admin user "${username}" created from environment variables.`);
  }
}
