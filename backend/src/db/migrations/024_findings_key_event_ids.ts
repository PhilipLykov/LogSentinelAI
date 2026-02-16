import type { Knex } from 'knex';

/**
 * Migration 024 — Add key_event_ids to findings table
 *
 * Stores the IDs of the source events that contributed to a finding,
 * enabling the "Show Events" button in the UI and providing
 * traceability from findings back to their source evidence.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('findings', 'key_event_ids');
  if (!hasColumn) {
    await knex.schema.alterTable('findings', (t) => {
      t.jsonb('key_event_ids').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('findings', 'key_event_ids');
  if (hasColumn) {
    await knex.schema.alterTable('findings', (t) => {
      t.dropColumn('key_event_ids');
    });
  }
}
