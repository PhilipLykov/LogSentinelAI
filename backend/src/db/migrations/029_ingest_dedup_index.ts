import type { Knex } from 'knex';

/**
 * Migration 029 — Ingestion deduplication unique index.
 *
 * 1. Removes existing duplicate events (keeps one row per
 *    normalized_hash + timestamp combination).
 * 2. Drops the old non-unique index on (normalized_hash, timestamp).
 * 3. Creates a UNIQUE index enabling ON CONFLICT dedup at ingestion time.
 *
 * Note: Knex wraps this in a transaction. The duplicate removal uses
 * ROW_NUMBER() which works across partitions.
 */
export async function up(knex: Knex): Promise<void> {
  // Step 1: Remove existing duplicates.
  // Keep the row with the smallest UUID (arbitrary but deterministic)
  // per (normalized_hash, timestamp) group.
  const delResult = await knex.raw(`
    DELETE FROM events
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY normalized_hash, "timestamp"
                 ORDER BY id
               ) AS rn
        FROM events
      ) numbered
      WHERE rn > 1
    )
  `);
  const removed = delResult.rowCount ?? 0;
  if (removed > 0) {
    console.log(`[Migration 029] Removed ${removed} duplicate event rows`);
  } else {
    console.log('[Migration 029] No duplicate events found');
  }

  // Step 2: Drop old non-unique index (idempotent)
  await knex.raw('DROP INDEX IF EXISTS idx_events_normalized_hash_ts');
  console.log('[Migration 029] Dropped old idx_events_normalized_hash_ts');

  // Step 3: Create unique index (timestamp is the partition key, so this is allowed)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup
    ON events (normalized_hash, "timestamp")
  `);
  console.log('[Migration 029] Created unique idx_events_dedup');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_events_dedup');
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_events_normalized_hash_ts
    ON events (normalized_hash, "timestamp")
  `);
}
