import type { Knex } from 'knex';

/**
 * Migration 027 — Normal Behavior Regex Upgrade
 *
 * 1. Add `host_pattern` and `program_pattern` columns so templates can
 *    optionally filter by event host and program (regex, nullable).
 * 2. Convert existing wildcard-style `pattern` values to their regex
 *    equivalents. The `pattern_regex` column already holds the compiled
 *    regex, so we copy it back into `pattern` to make `pattern` the
 *    canonical regex column going forward.
 *
 * NOTE: All indexes use plain CREATE INDEX (not CONCURRENTLY) because
 * Knex runs migrations inside a transaction.
 */
export async function up(knex: Knex): Promise<void> {
  const hasHostPattern = await knex.schema.hasColumn('normal_behavior_templates', 'host_pattern');
  if (!hasHostPattern) {
    await knex.schema.alterTable('normal_behavior_templates', (t) => {
      t.text('host_pattern').nullable();
      t.text('program_pattern').nullable();
    });
    console.log('[Migration 027] Added host_pattern and program_pattern columns');
  }

  // Convert existing wildcard patterns to regex.
  // `pattern_regex` already contains the correct regex derived from the
  // wildcard pattern, so we copy it into `pattern`.
  const updated = await knex.raw(`
    UPDATE normal_behavior_templates
    SET pattern = pattern_regex
    WHERE pattern <> pattern_regex
  `);
  const count = updated?.rowCount ?? 0;
  console.log(`[Migration 027] Converted ${count} wildcard patterns to regex`);
}

export async function down(knex: Knex): Promise<void> {
  const hasHostPattern = await knex.schema.hasColumn('normal_behavior_templates', 'host_pattern');
  if (hasHostPattern) {
    await knex.schema.alterTable('normal_behavior_templates', (t) => {
      t.dropColumn('host_pattern');
      t.dropColumn('program_pattern');
    });
  }
}
