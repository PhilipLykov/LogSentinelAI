import type { Knex } from 'knex';

/**
 * Phase 1 schema: criteria, monitored_systems, log_sources, events,
 * windows, event_scores, meta_results, api_keys.
 *
 * PostgreSQL types used throughout (uuid, timestamptz, jsonb).
 */
export async function up(knex: Knex): Promise<void> {
  // ── Enable uuid-ossp extension (for uuid_generate_v4 if needed) ──
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // ── criteria (6 fixed analysis criteria) ───────────────────
  await knex.schema.createTable('criteria', (t) => {
    t.integer('id').primary();
    t.string('slug', 64).notNullable().unique();
    t.string('name', 128).notNullable();
  });

  // ── monitored_systems ──────────────────────────────────────
  await knex.schema.createTable('monitored_systems', (t) => {
    t.uuid('id').primary();
    t.string('name', 255).notNullable();
    t.text('description').notNullable().defaultTo('');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── log_sources ────────────────────────────────────────────
  await knex.schema.createTable('log_sources', (t) => {
    t.uuid('id').primary();
    t.uuid('system_id').notNullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.string('label', 255).notNullable();
    t.jsonb('selector').notNullable();
    t.integer('priority').notNullable().defaultTo(0);   // lower = evaluated first
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['system_id']);
  });

  // ── events ─────────────────────────────────────────────────
  await knex.schema.createTable('events', (t) => {
    t.uuid('id').primary();
    t.uuid('system_id').notNullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.uuid('log_source_id').notNullable().references('id').inTable('log_sources').onDelete('CASCADE');
    t.uuid('connector_id').nullable();                  // FK added in Phase 6
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('timestamp', { useTz: true }).notNullable();
    t.text('message').notNullable();
    t.string('severity', 32).nullable();
    t.string('host', 255).nullable();
    t.string('service', 255).nullable();
    t.string('facility', 64).nullable();
    t.string('program', 255).nullable();
    t.string('trace_id', 128).nullable();
    t.string('span_id', 128).nullable();
    t.jsonb('raw').nullable();
    t.string('normalized_hash', 128).notNullable();
    t.string('external_id', 255).nullable();

    t.index(['system_id', 'timestamp']);
    t.index(['normalized_hash', 'timestamp']);
  });

  // Partial unique index for connector idempotency
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_connector_external
    ON events (connector_id, external_id)
    WHERE connector_id IS NOT NULL AND external_id IS NOT NULL
  `);

  // ── windows ────────────────────────────────────────────────
  await knex.schema.createTable('windows', (t) => {
    t.uuid('id').primary();
    t.uuid('system_id').notNullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.timestamp('from_ts', { useTz: true }).notNullable();
    t.timestamp('to_ts', { useTz: true }).notNullable();
    t.string('trigger', 16).notNullable().defaultTo('time');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['system_id', 'from_ts', 'to_ts']);
  });

  // ── event_scores ───────────────────────────────────────────
  await knex.schema.createTable('event_scores', (t) => {
    t.uuid('id').primary();
    t.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    t.integer('criterion_id').notNullable().references('id').inTable('criteria');
    t.float('score').notNullable();                      // 0.0–1.0
    t.jsonb('reason_codes').nullable();
    t.string('score_type', 16).notNullable().defaultTo('event');
    t.string('severity_label', 16).nullable();            // Phase 7
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['event_id', 'criterion_id', 'score_type']);
    t.index(['criterion_id']);
  });

  // ── meta_results ───────────────────────────────────────────
  await knex.schema.createTable('meta_results', (t) => {
    t.uuid('id').primary();
    t.uuid('window_id').notNullable().references('id').inTable('windows').onDelete('CASCADE');
    t.jsonb('meta_scores').notNullable();
    t.text('summary').notNullable().defaultTo('');
    t.jsonb('findings').notNullable();
    t.text('recommended_action').nullable();              // Phase 7
    t.jsonb('key_event_ids').nullable();                  // Phase 7
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['window_id']);
  });

  // ── api_keys ───────────────────────────────────────────────
  await knex.schema.createTable('api_keys', (t) => {
    t.uuid('id').primary();
    t.string('key_hash', 128).notNullable().unique();
    t.string('scope', 32).notNullable();                 // ingest | admin | read | dashboard
    t.string('name', 255).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meta_results');
  await knex.schema.dropTableIfExists('event_scores');
  await knex.schema.dropTableIfExists('windows');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('log_sources');
  await knex.schema.dropTableIfExists('monitored_systems');
  await knex.schema.dropTableIfExists('criteria');
  await knex.schema.dropTableIfExists('api_keys');
}
