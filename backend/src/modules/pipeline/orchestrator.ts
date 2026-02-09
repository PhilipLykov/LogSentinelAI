import type { Knex } from 'knex';
import { localTimestamp } from '../../config/index.js';
import { type LlmAdapter } from '../llm/adapter.js';
import { runPerEventScoringJob } from './scoringJob.js';
import { createWindows } from './windowing.js';
import { metaAnalyzeWindow } from './metaAnalyze.js';
import { evaluateAlerts } from '../alerting/evaluator.js';

/**
 * Pipeline orchestrator: runs the full scoring pipeline periodically.
 *
 * 1. Per-event scoring (dedup + LLM)
 * 2. Create windows
 * 3. Meta-analyze each new window
 * 4. Evaluate alerts only for windows that were successfully meta-analyzed
 *
 * Call this on a schedule (e.g. every 5 minutes) or after ingest.
 */
export async function runPipeline(
  db: Knex,
  llm: LlmAdapter,
  options?: { windowMinutes?: number; wMeta?: number; scoringLimit?: number },
): Promise<void> {
  const start = Date.now();
  console.log(`[${localTimestamp()}] Pipeline run started.`);

  try {
    // 1. Per-event scoring
    const scoringResult = await runPerEventScoringJob(db, llm, { limit: options?.scoringLimit ?? 500 });

    // 2. Create windows
    const windows = await createWindows(db, { windowMinutes: options?.windowMinutes });

    // 3. Meta-analyze each new window, track which succeed
    const analyzedWindows: typeof windows = [];
    for (const w of windows) {
      try {
        await metaAnalyzeWindow(db, llm, w.id, { wMeta: options?.wMeta });
        analyzedWindows.push(w);
      } catch (err) {
        console.error(`[${localTimestamp()}] Meta-analyze failed for window ${w.id}:`, err);
        // Don't evaluate alerts for failed windows (would cause false resolutions)
      }
    }

    // 4. Evaluate alerting rules ONLY for successfully analyzed windows
    for (const w of analyzedWindows) {
      try {
        await evaluateAlerts(db, w.id);
      } catch (err) {
        console.error(`[${localTimestamp()}] Alert evaluation failed for window ${w.id}:`, err);
      }
    }

    const elapsed = Date.now() - start;
    console.log(
      `[${localTimestamp()}] Pipeline run complete in ${elapsed}ms. Scored=${scoringResult.scored}, Windows=${windows.length}, Analyzed=${analyzedWindows.length}`,
    );
  } catch (err) {
    console.error(`[${localTimestamp()}] Pipeline run failed:`, err);
  }
}

/**
 * Start a periodic pipeline runner.
 * Returns a cleanup function to stop the interval.
 */
export function startPipelineScheduler(
  db: Knex,
  llm: LlmAdapter,
  intervalMs: number = 5 * 60 * 1000, // default 5 minutes
): { stop: () => void } {
  let running = false;

  const timer = setInterval(async () => {
    if (running) {
      console.log(`[${localTimestamp()}] Pipeline: previous run still in progress, skipping.`);
      return;
    }
    running = true;
    try {
      await runPipeline(db, llm);
    } finally {
      running = false;
    }
  }, intervalMs);

  console.log(`[${localTimestamp()}] Pipeline scheduler started (interval=${intervalMs}ms).`);

  return {
    stop: () => {
      clearInterval(timer);
      console.log(`[${localTimestamp()}] Pipeline scheduler stopped.`);
    },
  };
}
