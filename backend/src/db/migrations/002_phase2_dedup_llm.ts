import type { Knex } from 'knex';

/**
 * Phase 2: message_templates for dedup/template scoring, llm_usage for cost tracking.
 */
export async function up(knex: Knex): Promise<void> {
  // ── message_templates ──────────────────────────────────────
  await knex.schema.createTable('message_templates', (t) => {
    t.uuid('id').primary();
    t.uuid('system_id').nullable().references('id').inTable('monitored_systems').onDelete('SET NULL');
    t.text('template_text').notNullable();
    t.string('pattern_hash', 128).notNullable();
    t.integer('occurrence_count').notNullable().defaultTo(1);
    t.timestamp('first_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['system_id']);
    t.unique(['pattern_hash']);
  });

  // Add template_id to events
  await knex.schema.alterTable('events', (t) => {
    t.uuid('template_id').nullable().references('id').inTable('message_templates').onDelete('SET NULL');
  });

  // ── llm_usage ──────────────────────────────────────────────
  await knex.schema.createTable('llm_usage', (t) => {
    t.uuid('id').primary();
    t.string('run_type', 32).notNullable();       // 'per_event' | 'meta'
    t.uuid('system_id').nullable().references('id').inTable('monitored_systems').onDelete('SET NULL');
    t.uuid('window_id').nullable().references('id').inTable('windows').onDelete('SET NULL');
    t.integer('event_count').notNullable().defaultTo(0);
    t.integer('token_input').notNullable().defaultTo(0);
    t.integer('token_output').notNullable().defaultTo(0);
    t.integer('request_count').notNullable().defaultTo(0);
    t.decimal('cost_estimate', 10, 6).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['system_id']);
    t.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('events', (t) => {
    t.dropColumn('template_id');
  });
  await knex.schema.dropTableIfExists('llm_usage');
  await knex.schema.dropTableIfExists('message_templates');
}
