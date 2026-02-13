import type { Knex } from 'knex';

/**
 * Migration 023 — Normal Behavior Templates
 *
 * Users can mark event patterns as "normal behavior." Matching events
 * are excluded from LLM scoring and meta-analysis, eliminating noise
 * and saving tokens.
 *
 * Each template stores:
 *  - A user-friendly pattern with `*` wildcards
 *  - A compiled regex for efficient matching
 *  - The original event message for reference
 *  - Audit metadata (who created it, when)
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('normal_behavior_templates');
  if (exists) return;

  await knex.schema.createTable('normal_behavior_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('system_id').nullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.text('pattern').notNullable();
    t.text('pattern_regex').notNullable();
    t.text('original_message').notNullable();
    t.uuid('original_event_id').nullable();
    t.text('created_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.boolean('enabled').notNullable().defaultTo(true);
    t.text('notes').nullable();

    t.index(['system_id']);
    t.index(['enabled']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('normal_behavior_templates');
}
