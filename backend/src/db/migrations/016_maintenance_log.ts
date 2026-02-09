import type { Knex } from 'knex';

/**
 * Create maintenance_log table for tracking DB maintenance runs,
 * and ensure retention_days column exists on monitored_systems.
 */
export async function up(knex: Knex): Promise<void> {
  // Create maintenance_log table
  const hasTable = await knex.schema.hasTable('maintenance_log');
  if (!hasTable) {
    await knex.schema.createTable('maintenance_log', (t) => {
      t.increments('id').primary();
      t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('finished_at', { useTz: true });
      t.integer('duration_ms');
      t.integer('events_deleted').defaultTo(0);
      t.integer('event_scores_deleted').defaultTo(0);
      t.text('status').defaultTo('running'); // running | success | completed_with_errors | failed
      t.jsonb('details'); // full MaintenanceRunResult JSON
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('maintenance_log');
}
