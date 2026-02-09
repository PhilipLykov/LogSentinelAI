import type { Knex } from 'knex';

/**
 * Migration 015: Finding Lifecycle Enhancement
 *
 * Extends the findings table to support:
 * 1. Occurrence tracking (last_seen_at, occurrence_count) — "living findings"
 * 2. Fingerprinting for fast exact-match deduplication
 * 3. Staleness tracking (consecutive_misses) for auto-resolution
 * 4. Severity decay (original_severity preserved before decay)
 *
 * Also seeds default meta-analysis configuration and performs a one-time
 * duplicate finding cleanup (merging semantically identical open findings).
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Add new columns to findings table ──────────────────
  await knex.schema.alterTable('findings', (t) => {
    t.timestamp('last_seen_at', { useTz: true }).nullable();
    t.integer('occurrence_count').notNullable().defaultTo(1);
    t.text('fingerprint').nullable();
    t.integer('consecutive_misses').notNullable().defaultTo(0);
    t.string('original_severity', 16).nullable();
  });

  // Set last_seen_at = created_at for existing rows
  await knex.raw(`UPDATE findings SET last_seen_at = created_at WHERE last_seen_at IS NULL`);

  // Set original_severity = severity for existing rows
  await knex.raw(`UPDATE findings SET original_severity = severity WHERE original_severity IS NULL`);

  // ── 2. Add indexes for efficient dedup queries ────────────
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_findings_fingerprint
      ON findings (system_id, fingerprint)
      WHERE status = 'open'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_findings_open_system
      ON findings (system_id, status, last_seen_at)
      WHERE status = 'open'
  `);

  // ── 3. Seed default meta-analysis configuration ───────────
  const defaultConfig = {
    finding_dedup_enabled: true,
    finding_dedup_threshold: 0.6,
    max_new_findings_per_window: 5,
    auto_resolve_after_misses: 5,
    severity_decay_enabled: true,
    severity_decay_after_occurrences: 10,
    max_open_findings_per_system: 25,
  };

  await knex.raw(`
    INSERT INTO app_config (key, value)
    VALUES ('meta_analysis_config', ?::jsonb)
    ON CONFLICT (key) DO NOTHING
  `, [JSON.stringify(defaultConfig)]);

  // ── 4. One-time duplicate finding cleanup ─────────────────
  // Find groups of duplicate open findings per system (same criterion, similar text)
  // We use a simple approach: group by system_id + criterion_slug + first 60 chars of lowered text
  // This catches the most obvious duplicates without complex text analysis at migration time.
  await knex.raw(`
    WITH ranked AS (
      SELECT
        id,
        system_id,
        criterion_slug,
        severity,
        created_at,
        occurrence_count,
        LOWER(LEFT(text, 60)) AS text_prefix,
        ROW_NUMBER() OVER (
          PARTITION BY system_id, criterion_slug, LOWER(LEFT(text, 60))
          ORDER BY created_at ASC
        ) AS rn,
        COUNT(*) OVER (
          PARTITION BY system_id, criterion_slug, LOWER(LEFT(text, 60))
        ) AS group_size
      FROM findings
      WHERE status = 'open'
    ),
    -- For each group, update the oldest finding (rn=1) with the total count
    keeper_updates AS (
      UPDATE findings
      SET occurrence_count = ranked.group_size,
          last_seen_at = NOW()
      FROM ranked
      WHERE findings.id = ranked.id
        AND ranked.rn = 1
        AND ranked.group_size > 1
      RETURNING findings.id
    )
    -- Delete all but the oldest in each group
    DELETE FROM findings
    WHERE id IN (
      SELECT id FROM ranked WHERE rn > 1 AND group_size > 1
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('findings', (t) => {
    t.dropColumn('last_seen_at');
    t.dropColumn('occurrence_count');
    t.dropColumn('fingerprint');
    t.dropColumn('consecutive_misses');
    t.dropColumn('original_severity');
  });

  await knex.raw(`DROP INDEX IF EXISTS idx_findings_fingerprint`);
  await knex.raw(`DROP INDEX IF EXISTS idx_findings_open_system`);
  await knex.raw(`DELETE FROM app_config WHERE key = 'meta_analysis_config'`);
}
