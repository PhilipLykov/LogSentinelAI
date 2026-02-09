import type { Knex } from 'knex';

/**
 * Phase 3: effective_scores materialized view table for fast dashboard reads.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('effective_scores', (t) => {
    t.uuid('window_id').notNullable().references('id').inTable('windows').onDelete('CASCADE');
    t.uuid('system_id').notNullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.integer('criterion_id').notNullable().references('id').inTable('criteria');
    t.float('effective_value').notNullable();
    t.float('meta_score').notNullable().defaultTo(0);
    t.float('max_event_score').notNullable().defaultTo(0);
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.primary(['window_id', 'system_id', 'criterion_id']);
    t.index(['system_id', 'updated_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('effective_scores');
}
