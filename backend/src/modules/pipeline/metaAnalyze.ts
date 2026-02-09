import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { localTimestamp } from '../../config/index.js';
import { type LlmAdapter, type ScoreResult } from '../llm/adapter.js';
import { estimateCost } from '../llm/pricing.js';
import { CRITERIA } from '../../types/index.js';

const DEFAULT_W_META = 0.7;

/**
 * Meta-analyze a window: gather events + scores, call LLM, store meta_results,
 * compute effective scores. All writes in a single transaction.
 */
export async function metaAnalyzeWindow(
  db: Knex,
  llm: LlmAdapter,
  windowId: string,
  options?: { wMeta?: number },
): Promise<void> {
  const wMeta = options?.wMeta ?? DEFAULT_W_META;

  const window = await db('windows').where({ id: windowId }).first();
  if (!window) throw new Error(`Window ${windowId} not found`);

  const system = await db('monitored_systems').where({ id: window.system_id }).first();
  if (!system) throw new Error(`System ${window.system_id} not found`);

  const sources = await db('log_sources').where({ system_id: system.id }).select('label');
  const sourceLabels = sources.map((s: any) => s.label);

  // Gather events in window
  const events = await db('events')
    .where({ system_id: system.id })
    .where('timestamp', '>=', window.from_ts)
    .where('timestamp', '<', window.to_ts)
    .select('id', 'message', 'severity', 'template_id')
    .orderBy('timestamp', 'asc')
    .limit(200); // Cap for LLM context

  if (events.length === 0) {
    console.log(`[${localTimestamp()}] Meta-analyze: no events in window ${windowId}`);
    return;
  }

  // Gather per-event scores for context (batched for large event sets)
  const eventIds = events.map((e: any) => e.id);
  const allScores: any[] = [];
  for (let i = 0; i < eventIds.length; i += 100) {
    const chunk = eventIds.slice(i, i + 100);
    const rows = await db('event_scores')
      .whereIn('event_id', chunk)
      .select('event_id', 'criterion_id', 'score');
    allScores.push(...rows);
  }

  // Build score map: event_id → ScoreResult
  const scoreMap = new Map<string, ScoreResult>();
  for (const row of allScores) {
    if (!scoreMap.has(row.event_id)) {
      scoreMap.set(row.event_id, {
        it_security: 0, performance_degradation: 0, failure_prediction: 0,
        anomaly: 0, compliance_audit: 0, operational_risk: 0,
      });
    }
    const criterion = CRITERIA.find((c) => c.id === Number(row.criterion_id));
    if (criterion) {
      (scoreMap.get(row.event_id)! as any)[criterion.slug] = Number(row.score);
    }
  }

  // Deduplicate by template for LLM input
  const templateGroups = new Map<string, { message: string; severity?: string; count: number; scores?: ScoreResult }>();
  for (const event of events) {
    const key = event.template_id ?? event.id;
    if (!templateGroups.has(key)) {
      templateGroups.set(key, {
        message: event.message,
        severity: event.severity,
        count: 0,
        scores: scoreMap.get(event.id),
      });
    }
    templateGroups.get(key)!.count++;
  }

  const eventsForLlm = Array.from(templateGroups.values()).map((g) => ({
    message: g.message,
    severity: g.severity,
    scores: g.scores,
    occurrenceCount: g.count,
  }));

  // Call LLM for meta-analysis
  const { result, usage } = await llm.metaAnalyze(
    eventsForLlm,
    system.description ?? '',
    sourceLabels,
  );

  // Store everything in a transaction for consistency
  await db.transaction(async (trx) => {
    // Store meta_result
    const metaId = uuidv4();
    await trx('meta_results').insert({
      id: metaId,
      window_id: windowId,
      meta_scores: JSON.stringify(result.meta_scores),
      summary: result.summary,
      findings: JSON.stringify(result.findings),
      recommended_action: result.recommended_action ?? null,
      key_event_ids: result.key_event_ids ? JSON.stringify(result.key_event_ids) : null,
    });

    // Compute effective scores per criterion
    const now = new Date().toISOString();
    for (const criterion of CRITERIA) {
      const metaScore = (result.meta_scores as any)[criterion.slug] ?? 0;

      // Max per-event score for this criterion in this window
      const maxEventRow = await trx('event_scores')
        .whereIn('event_id', eventIds)
        .where({ criterion_id: criterion.id })
        .max('score as max_score')
        .first();

      const maxEventScore = Number(maxEventRow?.max_score ?? 0);

      // Blend: effective = w_meta * meta + (1 - w_meta) * max(per_event)
      const effectiveValue = wMeta * metaScore + (1 - wMeta) * maxEventScore;

      // Upsert effective_scores
      await trx.raw(`
        INSERT INTO effective_scores (window_id, system_id, criterion_id, effective_value, meta_score, max_event_score, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (window_id, system_id, criterion_id)
        DO UPDATE SET effective_value = EXCLUDED.effective_value,
                      meta_score = EXCLUDED.meta_score,
                      max_event_score = EXCLUDED.max_event_score,
                      updated_at = EXCLUDED.updated_at
      `, [windowId, system.id, criterion.id, effectiveValue, metaScore, maxEventScore, now]);
    }

    // Track LLM usage (model + cost locked in at insert time)
    await trx('llm_usage').insert({
      id: uuidv4(),
      run_type: 'meta',
      model: usage.model || null,
      system_id: system.id,
      window_id: windowId,
      event_count: events.length,
      token_input: usage.token_input,
      token_output: usage.token_output,
      request_count: usage.request_count,
      cost_estimate: usage.model ? estimateCost(usage.token_input, usage.token_output, usage.model) : null,
    });
  });

  console.log(
    `[${localTimestamp()}] Meta-analyze window ${windowId}: ${events.length} events, ${eventsForLlm.length} templates, tokens=${usage.token_input + usage.token_output}`,
  );
}
