/**
 * Database Maintenance Job
 *
 * Performs periodic database maintenance tasks:
 * 1. Data retention cleanup — delete events older than the configured retention period
 * 2. VACUUM ANALYZE — reclaim storage and update query planner statistics
 * 3. REINDEX — rebuild indexes for optimal performance
 * 4. Log run history to maintenance_log table
 *
 * Each system can have its own retention_days (NULL = use global default).
 */

import type { Knex } from 'knex';
import { localTimestamp } from '../../config/index.js';

// ── Types ──────────────────────────────────────────────────────

export interface MaintenanceConfig {
  default_retention_days: number;
  maintenance_interval_hours: number;
}

export interface MaintenanceRunResult {
  started_at: string;
  finished_at: string;
  duration_ms: number;
  events_deleted: number;
  event_scores_deleted: number;
  systems_cleaned: Array<{ system_id: string; system_name: string; retention_days: number; events_deleted: number }>;
  vacuum_ran: boolean;
  reindex_ran: boolean;
  errors: string[];
}

const CONFIG_DEFAULTS: MaintenanceConfig = {
  default_retention_days: 90,
  maintenance_interval_hours: 6,
};

// ── Config Loader ──────────────────────────────────────────────

export async function loadMaintenanceConfig(db: Knex): Promise<MaintenanceConfig> {
  try {
    const rows = await db('app_config')
      .whereIn('key', ['default_retention_days', 'maintenance_interval_hours'])
      .select('key', 'value');

    const cfg = { ...CONFIG_DEFAULTS };
    for (const row of rows) {
      let v = row.value;
      if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { /* use as-is */ }
      }
      const num = Number(v);
      if (row.key === 'default_retention_days' && Number.isFinite(num) && num > 0) {
        cfg.default_retention_days = num;
      }
      if (row.key === 'maintenance_interval_hours' && Number.isFinite(num) && num > 0) {
        cfg.maintenance_interval_hours = num;
      }
    }
    return cfg;
  } catch (err) {
    console.error(`[${localTimestamp()}] Failed to load maintenance config:`, err);
    return { ...CONFIG_DEFAULTS };
  }
}

// ── Main Maintenance Job ───────────────────────────────────────

export async function runMaintenance(db: Knex): Promise<MaintenanceRunResult> {
  const startTime = Date.now();
  const started_at = new Date().toISOString();
  const errors: string[] = [];

  console.log(`[${localTimestamp()}] Maintenance: starting database maintenance run...`);

  const config = await loadMaintenanceConfig(db);
  let totalEventsDeleted = 0;
  let totalScoresDeleted = 0;
  const systemsCleanedList: MaintenanceRunResult['systems_cleaned'] = [];
  let vacuumRan = false;
  let reindexRan = false;

  // ── 1. Data Retention Cleanup ─────────────────────────────
  try {
    const systems = await db('monitored_systems')
      .select('id', 'name', 'retention_days');

    for (const system of systems) {
      const retentionDays = system.retention_days ?? config.default_retention_days;
      if (retentionDays <= 0) continue; // 0 or negative = keep forever

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffIso = cutoffDate.toISOString();

      try {
        // Find old event IDs (batch to avoid memory issues)
        let systemEventsDeleted = 0;
        let systemScoresDeleted = 0;

        // Delete in batches of 1000 to avoid long locks
        let hasMore = true;
        while (hasMore) {
          const oldEventIds = await db('events')
            .where({ system_id: system.id })
            .where('timestamp', '<', cutoffIso)
            .limit(1000)
            .pluck('id');

          if (oldEventIds.length === 0) {
            hasMore = false;
            break;
          }

          // Delete event_scores for these events
          for (let i = 0; i < oldEventIds.length; i += 500) {
            const chunk = oldEventIds.slice(i, i + 500);
            const deleted = await db('event_scores').whereIn('event_id', chunk).del();
            systemScoresDeleted += deleted;
          }

          // Delete the events themselves
          const eventsDeleted = await db('events').whereIn('id', oldEventIds).del();
          systemEventsDeleted += eventsDeleted;

          if (oldEventIds.length < 1000) {
            hasMore = false;
          }
        }

        if (systemEventsDeleted > 0) {
          systemsCleanedList.push({
            system_id: system.id,
            system_name: system.name,
            retention_days: retentionDays,
            events_deleted: systemEventsDeleted,
          });
          totalEventsDeleted += systemEventsDeleted;
          totalScoresDeleted += systemScoresDeleted;

          console.log(
            `[${localTimestamp()}] Maintenance: ${system.name} — deleted ${systemEventsDeleted} events ` +
            `and ${systemScoresDeleted} scores older than ${retentionDays} days`,
          );
        }
      } catch (err: any) {
        const msg = `Retention cleanup failed for system ${system.name}: ${err.message}`;
        console.error(`[${localTimestamp()}] Maintenance: ${msg}`);
        errors.push(msg);
      }
    }

    // Also clean up orphaned message templates with no events
    try {
      const orphanedTemplates = await db('message_templates')
        .whereNotExists(
          db('events')
            .whereRaw('events.template_id = message_templates.id')
            .select(db.raw('1')),
        )
        .del();
      if (orphanedTemplates > 0) {
        console.log(`[${localTimestamp()}] Maintenance: cleaned up ${orphanedTemplates} orphaned message templates`);
      }
    } catch (err: any) {
      errors.push(`Orphaned template cleanup failed: ${err.message}`);
    }

    // Clean up old maintenance logs (keep last 100)
    try {
      const oldLogs = await db('maintenance_log')
        .orderBy('started_at', 'desc')
        .offset(100)
        .pluck('id');
      if (oldLogs.length > 0) {
        await db('maintenance_log').whereIn('id', oldLogs).del();
      }
    } catch {
      // maintenance_log table might not exist yet on first run — ignore
    }

  } catch (err: any) {
    const msg = `Data retention cleanup failed: ${err.message}`;
    console.error(`[${localTimestamp()}] Maintenance: ${msg}`);
    errors.push(msg);
  }

  // ── 2. VACUUM ANALYZE ─────────────────────────────────────
  try {
    // VACUUM cannot run inside a transaction, so use raw queries
    const tables = ['events', 'event_scores', 'message_templates', 'findings', 'meta_results', 'windows'];
    for (const table of tables) {
      try {
        await db.raw(`VACUUM ANALYZE ${table}`);
      } catch (err: any) {
        // Some tables might not exist — that's OK
        if (!err.message.includes('does not exist')) {
          errors.push(`VACUUM ANALYZE ${table} failed: ${err.message}`);
        }
      }
    }
    vacuumRan = true;
    console.log(`[${localTimestamp()}] Maintenance: VACUUM ANALYZE completed`);
  } catch (err: any) {
    const msg = `VACUUM ANALYZE failed: ${err.message}`;
    console.error(`[${localTimestamp()}] Maintenance: ${msg}`);
    errors.push(msg);
  }

  // ── 3. REINDEX ────────────────────────────────────────────
  try {
    const indexes = [
      'idx_events_system_ts',
      'idx_events_template',
      'idx_event_scores_event',
      'idx_findings_fingerprint',
      'idx_findings_open_system',
    ];
    for (const idx of indexes) {
      try {
        await db.raw(`REINDEX INDEX CONCURRENTLY ${idx}`);
      } catch (err: any) {
        // Index might not exist — that's OK
        if (!err.message.includes('does not exist')) {
          // REINDEX CONCURRENTLY requires PG 12+; fall back to regular REINDEX
          try {
            await db.raw(`REINDEX INDEX ${idx}`);
          } catch (err2: any) {
            if (!err2.message.includes('does not exist')) {
              errors.push(`REINDEX ${idx} failed: ${err2.message}`);
            }
          }
        }
      }
    }
    reindexRan = true;
    console.log(`[${localTimestamp()}] Maintenance: REINDEX completed`);
  } catch (err: any) {
    const msg = `REINDEX failed: ${err.message}`;
    console.error(`[${localTimestamp()}] Maintenance: ${msg}`);
    errors.push(msg);
  }

  // ── 4. Log the run ────────────────────────────────────────
  const finished_at = new Date().toISOString();
  const duration_ms = Date.now() - startTime;

  const result: MaintenanceRunResult = {
    started_at,
    finished_at,
    duration_ms,
    events_deleted: totalEventsDeleted,
    event_scores_deleted: totalScoresDeleted,
    systems_cleaned: systemsCleanedList,
    vacuum_ran: vacuumRan,
    reindex_ran: reindexRan,
    errors,
  };

  try {
    await db('maintenance_log').insert({
      started_at,
      finished_at,
      duration_ms,
      events_deleted: totalEventsDeleted,
      event_scores_deleted: totalScoresDeleted,
      details: JSON.stringify(result),
      status: errors.length > 0 ? 'completed_with_errors' : 'success',
    });
  } catch {
    // maintenance_log table might not exist on first run
    console.warn(`[${localTimestamp()}] Maintenance: could not log run to maintenance_log table`);
  }

  console.log(
    `[${localTimestamp()}] Maintenance: completed in ${duration_ms}ms — ` +
    `${totalEventsDeleted} events deleted, ${totalScoresDeleted} scores deleted, ` +
    `${errors.length} error(s)`,
  );

  return result;
}

// ── Scheduler ──────────────────────────────────────────────────

export function startMaintenanceScheduler(
  db: Knex,
  intervalMs: number = 6 * 60 * 60 * 1000, // default 6 hours
): { stop: () => void } {
  let running = false;

  const timer = setInterval(async () => {
    if (running) {
      console.log(`[${localTimestamp()}] Maintenance: previous run still in progress, skipping.`);
      return;
    }
    running = true;
    try {
      // Re-read interval from config each time (user may have changed it via UI)
      const config = await loadMaintenanceConfig(db);
      // Only run if enough time has passed since last run
      try {
        const lastRun = await db('maintenance_log')
          .orderBy('started_at', 'desc')
          .first('started_at');
        if (lastRun) {
          const lastRunTime = new Date(lastRun.started_at).getTime();
          const minInterval = config.maintenance_interval_hours * 60 * 60 * 1000;
          if (Date.now() - lastRunTime < minInterval) {
            return; // Not enough time has passed
          }
        }
      } catch {
        // maintenance_log might not exist yet — proceed with the run
      }

      await runMaintenance(db);
    } catch (err) {
      console.error(`[${localTimestamp()}] Maintenance scheduler error:`, err);
    } finally {
      running = false;
    }
  }, intervalMs);

  console.log(`[${localTimestamp()}] Maintenance scheduler started (check interval=${intervalMs}ms).`);

  return {
    stop: () => {
      clearInterval(timer);
      console.log(`[${localTimestamp()}] Maintenance scheduler stopped.`);
    },
  };
}
