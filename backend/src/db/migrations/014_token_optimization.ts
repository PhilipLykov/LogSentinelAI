import type { Knex } from 'knex';

/**
 * Migration 014 — Token optimisation.
 *
 * 1. Add score-caching columns to `message_templates` so the pipeline can
 *    skip LLM calls for recently-scored templates.
 * 2. Seed the `token_optimization` configuration key in `app_config` with
 *    sensible defaults.
 */
export async function up(knex: Knex): Promise<void> {
  // ── Extend message_templates with score-cache columns ────────
  await knex.schema.alterTable('message_templates', (t) => {
    /** When this template was last scored by the LLM. */
    t.timestamp('last_scored_at', { useTz: true }).nullable();

    /** JSON map of criterion_slug → score from the most recent LLM call. */
    t.jsonb('cached_scores').nullable();

    /** How many times this template has been scored by the LLM. */
    t.integer('score_count').notNullable().defaultTo(0);

    /** Rolling average of the max score across all six criteria. */
    t.decimal('avg_max_score', 5, 4).nullable();
  });

  // Index for efficient "cache miss" queries (templates needing re-scoring)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_templates_last_scored
    ON message_templates (last_scored_at)
    WHERE last_scored_at IS NOT NULL
  `);

  // ── Seed default token_optimization config ───────────────────
  const defaultConfig = {
    score_cache_enabled: true,
    score_cache_ttl_minutes: 60,
    severity_filter_enabled: false,
    severity_skip_levels: ['debug'],
    severity_default_score: 0,
    message_max_length: 512,
    scoring_batch_size: 20,
    low_score_auto_skip_enabled: false,
    low_score_threshold: 0.05,
    low_score_min_scorings: 5,
    meta_max_events: 200,
    meta_prioritize_high_scores: true,
  };

  await knex.raw(`
    INSERT INTO app_config (key, value)
    VALUES ('token_optimization', ?::jsonb)
    ON CONFLICT (key) DO NOTHING
  `, [JSON.stringify(defaultConfig)]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_templates_last_scored');

  await knex.schema.alterTable('message_templates', (t) => {
    t.dropColumn('avg_max_score');
    t.dropColumn('score_count');
    t.dropColumn('cached_scores');
    t.dropColumn('last_scored_at');
  });

  await knex('app_config').where({ key: 'token_optimization' }).del();
}
