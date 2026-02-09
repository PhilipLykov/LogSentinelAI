import type { Knex } from 'knex';

/**
 * Phase 5: Alerting tables — notification_channels, notification_rules,
 * alert_history, silences.
 */
export async function up(knex: Knex): Promise<void> {
  // ── notification_channels ──────────────────────────────────
  await knex.schema.createTable('notification_channels', (t) => {
    t.uuid('id').primary();
    t.string('type', 32).notNullable();   // webhook | pushover | ntfy | gotify | telegram
    t.string('name', 255).notNullable();
    t.jsonb('config').notNullable();       // secrets via env refs, no plain secrets
    t.boolean('enabled').notNullable().defaultTo(true);
    t.string('scope', 32).notNullable().defaultTo('global'); // global | per_system
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── notification_rules ─────────────────────────────────────
  await knex.schema.createTable('notification_rules', (t) => {
    t.uuid('id').primary();
    t.uuid('channel_id').notNullable().references('id').inTable('notification_channels').onDelete('CASCADE');
    t.string('trigger_type', 32).notNullable();         // threshold | schedule
    t.jsonb('trigger_config').notNullable();             // { criterion_id, min_score, system_ids } or { cron }
    t.jsonb('filters').nullable();                       // { system_ids, severity_bands }
    t.integer('throttle_interval_seconds').nullable();
    t.boolean('send_recovery').notNullable().defaultTo(true);
    t.boolean('notify_only_on_state_change').notNullable().defaultTo(false);
    t.text('template_title').nullable();
    t.text('template_body').nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['channel_id']);
  });

  // ── alert_history ──────────────────────────────────────────
  await knex.schema.createTable('alert_history', (t) => {
    t.uuid('id').primary();
    t.uuid('rule_id').notNullable().references('id').inTable('notification_rules').onDelete('CASCADE');
    t.uuid('channel_id').notNullable().references('id').inTable('notification_channels').onDelete('CASCADE');
    t.uuid('system_id').notNullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.uuid('window_id').nullable().references('id').inTable('windows').onDelete('SET NULL');
    t.integer('criterion_id').nullable().references('id').inTable('criteria');
    t.string('state', 16).notNullable();                // firing | resolved
    t.string('severity', 16).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['rule_id', 'system_id', 'criterion_id', 'created_at']);
    t.index(['system_id', 'created_at']);
  });

  // ── silences ───────────────────────────────────────────────
  await knex.schema.createTable('silences', (t) => {
    t.uuid('id').primary();
    t.string('name', 255).nullable();
    t.timestamp('starts_at', { useTz: true }).notNullable();
    t.timestamp('ends_at', { useTz: true }).notNullable();
    t.jsonb('scope').notNullable();                      // { global: true } | { system_ids: [] } | { rule_ids: [] }
    t.text('comment').nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('silences');
  await knex.schema.dropTableIfExists('alert_history');
  await knex.schema.dropTableIfExists('notification_rules');
  await knex.schema.dropTableIfExists('notification_channels');
}
