import type { getDb } from '../../db/index.js';

/** Default meta-weight for effective score blending (must match metaAnalyze). */
export const DEFAULT_W_META = 0.7;

/**
 * Recalculate effective_scores for recent windows belonging to a system.
 * Called after ack/unack to ensure the score bars reflect the change immediately.
 *
 * Uses a single SQL CTE+UPDATE instead of a nested loop over windows x criteria
 * (previously ~36,000 queries, now 1 query).
 *
 * Supports both PG-backed systems (events in `events` table) and ES-backed
 * systems (events tracked via `es_event_metadata`).  The LATERAL subquery
 * uses a UNION to find max scores from both sources.
 */
export async function recalcEffectiveScores(db: ReturnType<typeof getDb>, systemId: string | null): Promise<number> {
  let windowDays = 7;
  try {
    const cfgRow = await db('app_config').where({ key: 'dashboard_config' }).first('value');
    if (cfgRow?.value) {
      const parsed = typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : cfgRow.value;
      const d = Number(parsed.score_display_window_days);
      if (d > 0 && d <= 90) windowDays = d;
    }
  } catch { /* use default */ }

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // Single CTE query: for every effective_scores row in the display range,
  // recalculate max_event_score from un-acknowledged events, then apply
  // the zero-meta rule and blending formula.
  //
  // The LATERAL subquery has two UNION branches:
  //   1. PG events: JOIN events → event_scores (WHERE acknowledged_at IS NULL)
  //   2. ES events: JOIN es_event_metadata → event_scores (WHERE acknowledged_at IS NULL)
  // This ensures both storage backends contribute to effective scores.
  //
  // The system filter is built conditionally to avoid the PostgreSQL
  // "could not determine data type of parameter" error that occurs when
  // using (? IS NULL OR col = ?) with untyped NULL parameters.
  const systemFilter = systemId ? 'AND eff.system_id = ?' : '';
  const params: unknown[] = systemId
    ? [since, systemId, DEFAULT_W_META, 1 - DEFAULT_W_META]
    : [since, DEFAULT_W_META, 1 - DEFAULT_W_META];

  const result = await db.raw(`
    WITH window_max AS (
      SELECT
        eff.window_id,
        eff.system_id,
        eff.criterion_id,
        eff.meta_score AS orig_meta,
        COALESCE(sub.max_score, 0) AS new_max
      FROM effective_scores eff
      JOIN windows w ON eff.window_id = w.id
      LEFT JOIN LATERAL (
        SELECT MAX(combined.score) AS max_score
        FROM (
          -- PG events path
          SELECT es.score
          FROM events e
          JOIN event_scores es ON es.event_id = e.id::text
          WHERE e.system_id = eff.system_id
            AND e.timestamp >= w.from_ts
            AND e.timestamp <= w.to_ts
            AND e.acknowledged_at IS NULL
            AND es.criterion_id = eff.criterion_id
            AND es.score_type = 'event'
            AND NOT EXISTS (
              SELECT 1 FROM normal_behavior_templates nbt
              WHERE nbt.enabled = true
                AND (nbt.system_id IS NULL OR nbt.system_id = e.system_id)
                AND e.message ~* nbt.pattern
                AND (nbt.host_pattern IS NULL OR e.host ~* nbt.host_pattern)
                AND (nbt.program_pattern IS NULL OR e.program ~* nbt.program_pattern)
            )
          UNION ALL
          -- ES events path (metadata tracked in es_event_metadata)
          SELECT es.score
          FROM es_event_metadata em
          JOIN event_scores es ON es.event_id = em.es_event_id
          WHERE em.system_id = eff.system_id
            AND em.event_timestamp >= w.from_ts
            AND em.event_timestamp <= w.to_ts
            AND em.acknowledged_at IS NULL
            AND es.criterion_id = eff.criterion_id
            AND es.score_type = 'event'
        ) combined
      ) sub ON true
      WHERE w.to_ts >= ?
        ${systemFilter}
    )
    UPDATE effective_scores eff
    SET max_event_score = wm.new_max,
        meta_score = CASE WHEN wm.new_max = 0 THEN 0 ELSE wm.orig_meta END,
        effective_value = ? * (CASE WHEN wm.new_max = 0 THEN 0 ELSE wm.orig_meta END)
                        + ? * wm.new_max,
        updated_at = NOW()
    FROM window_max wm
    WHERE eff.window_id = wm.window_id
      AND eff.system_id = wm.system_id
      AND eff.criterion_id = wm.criterion_id
  `, params);

  return result.rowCount ?? 0;
}
