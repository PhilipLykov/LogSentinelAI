import type { Knex } from 'knex';

/**
 * Migration 019: User management, RBAC, sessions, API key enhancements,
 * and audit log immutability.
 *
 * This migration introduces:
 * 1. `users` table with username/password auth and role-based access
 * 2. `sessions` table for stateful session management
 * 3. Enhancements to `api_keys` (expiry, IP allowlist, soft revocation)
 * 4. Enhancements to `audit_log` (user_id, session_id)
 * 5. PostgreSQL trigger to make audit_log immutable (no UPDATE/DELETE)
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. users table ────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary();
    t.string('username', 128).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('display_name', 255).nullable();
    t.string('email', 255).nullable();
    t.string('role', 32).notNullable().defaultTo('monitoring_agent'); // administrator | auditor | monitoring_agent
    t.boolean('is_active').notNullable().defaultTo(true);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.timestamp('last_login_at', { useTz: true }).nullable();
    t.integer('failed_login_count').notNullable().defaultTo(0);
    t.timestamp('locked_until', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');

    t.index(['username']);
    t.index(['role']);
    t.index(['is_active']);
  });

  // ── 2. sessions table ─────────────────────────────────────────
  await knex.schema.createTable('sessions', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable().unique();
    t.string('ip', 64).nullable();
    t.text('user_agent').nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['user_id']);
    t.index(['expires_at']);
    t.index(['token_hash']);
  });

  // ── 3. Enhance api_keys table ─────────────────────────────────
  await knex.schema.alterTable('api_keys', (t) => {
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.timestamp('last_used_at', { useTz: true }).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.specificType('allowed_ips', 'TEXT[]').nullable();
    t.text('description').nullable();
  });

  // ── 4. Enhance audit_log table ────────────────────────────────
  await knex.schema.alterTable('audit_log', (t) => {
    t.uuid('user_id').nullable();
    t.uuid('session_id').nullable();
  });

  // ── 5. Audit log immutability trigger ─────────────────────────
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_audit_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Audit log records cannot be modified or deleted';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Remove audit trigger
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log');
  await knex.raw('DROP FUNCTION IF EXISTS prevent_audit_modification()');

  // Remove audit_log enhancements
  await knex.schema.alterTable('audit_log', (t) => {
    t.dropColumn('user_id');
    t.dropColumn('session_id');
  });

  // Remove api_keys enhancements
  await knex.schema.alterTable('api_keys', (t) => {
    t.dropColumn('created_by');
    t.dropColumn('expires_at');
    t.dropColumn('last_used_at');
    t.dropColumn('is_active');
    t.dropColumn('allowed_ips');
    t.dropColumn('description');
  });

  // Drop sessions and users
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
}
