import type { Knex } from 'knex';

/**
 * Migration 028: Add per-system timezone offset and future-timestamp guard config.
 *
 * - `monitored_systems.tz_offset_minutes`: integer, nullable, default NULL.
 *   Offset in minutes to apply to event timestamps from this system during
 *   ingestion.  NULL = no correction.  Positive = source is AHEAD of server TZ
 *   (subtract from timestamp), Negative = source is BEHIND (add to timestamp).
 *   Example: source in UTC+5 but Fluent Bit in UTC+2 → tz_offset_minutes = 180
 *   (3 hours × 60 min) — the backend subtracts 180 min to correct the timestamp.
 *
 * - `pipeline_config.max_future_drift_seconds` is stored in the existing
 *   `app_config` JSON column, so no schema change is needed for it.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('monitored_systems', 'tz_offset_minutes');
  if (!hasColumn) {
    await knex.schema.alterTable('monitored_systems', (t) => {
      t.integer('tz_offset_minutes').nullable().defaultTo(null);
    });
    console.log('[Migration 028] Added tz_offset_minutes column to monitored_systems');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('monitored_systems', 'tz_offset_minutes');
  if (hasColumn) {
    await knex.schema.alterTable('monitored_systems', (t) => {
      t.dropColumn('tz_offset_minutes');
    });
  }
}
