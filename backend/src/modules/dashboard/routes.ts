import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { PERMISSIONS } from '../../middleware/permissions.js';
import { CRITERIA } from '../../types/index.js';
import { localTimestamp } from '../../config/index.js';
import { writeAuditLog } from '../../middleware/audit.js';
import { getEventSource, getDefaultEventSource } from '../../services/eventSourceFactory.js';

/**
 * Dashboard-oriented API routes: system overview, drill-down, SSE stream.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();
  const eventSource = getDefaultEventSource(db);

  // ── Dashboard overview: systems with latest effective scores ─
  app.get(
    '/api/v1/dashboard/systems',
    { preHandler: requireAuth(PERMISSIONS.DASHBOARD_VIEW) },
    async (_request, reply) => {
      const systems = await db('monitored_systems').orderBy('name').select('*');
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const result = [];
      for (const system of systems) {
        // Latest window for this system (used for display metadata)
        const latestWindow = await db('windows')
          .where({ system_id: system.id })
          .orderBy('to_ts', 'desc')
          .first();

        let scores: Record<string, { effective: number; meta: number; max_event: number }> = {};

        if (latestWindow) {
          // Use MAX effective scores across all windows in the last 24 hours.
          // A single 5-minute window of routine events shouldn't mask elevated
          // scores from recent windows — this gives a "worst recent state" view
          // which is more appropriate for security monitoring.
          const effectiveRows = await db('effective_scores')
            .join('windows', 'effective_scores.window_id', 'windows.id')
            .where('effective_scores.system_id', system.id)
            .where('windows.to_ts', '>=', since24h)
            .groupBy('effective_scores.criterion_id')
            .select(
              'effective_scores.criterion_id',
              db.raw('MAX(effective_scores.effective_value) as effective_value'),
              db.raw('MAX(effective_scores.meta_score) as meta_score'),
              db.raw('MAX(effective_scores.max_event_score) as max_event_score'),
            );

          for (const row of effectiveRows) {
            const criterion = CRITERIA.find((c) => c.id === row.criterion_id);
            if (criterion) {
              scores[criterion.slug] = {
                effective: Number(row.effective_value) || 0,
                meta: Number(row.meta_score) || 0,
                max_event: Number(row.max_event_score) || 0,
              };
            }
          }
        }

        // Source count
        const sourceCount = await db('log_sources')
          .where({ system_id: system.id })
          .count('id as cnt')
          .first();

        // Event count (last 24h) — via EventSource abstraction (per-system dispatch)
        const sysEventSource = getEventSource(system, db);
        const eventCount24h = await sysEventSource.countSystemEvents(system.id, since24h);

        result.push({
          id: system.id,
          name: system.name,
          description: system.description,
          source_count: Number(sourceCount?.cnt ?? 0),
          event_count_24h: eventCount24h,
          latest_window: latestWindow
            ? { id: latestWindow.id, from: latestWindow.from_ts, to: latestWindow.to_ts }
            : null,
          scores,
          updated_at: system.updated_at,
        });
      }

      return reply.send(result);
    },
  );

  // ── Drill-down: events for a system ────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: {
      from?: string; to?: string; limit?: string;
      severity?: string; host?: string; program?: string;
      service?: string; facility?: string;
    };
  }>(
    '/api/v1/systems/:id/events',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_VIEW) },
    async (request, reply) => {
      const { id } = request.params;
      const { from, to } = request.query;
      const rawLimit = Number(request.query.limit ?? 100);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 500) : 100;

      // Parse comma-separated multi-value filter params into arrays
      const parseFilter = (val?: string): string[] | undefined => {
        if (!val) return undefined;
        const items = val.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        return items.length > 0 ? items : undefined;
      };

      // Load system to determine event source
      const system = await db('monitored_systems').where({ id }).first();
      const sysEventSource = system ? getEventSource(system, db) : eventSource;
      const events = await sysEventSource.getSystemEvents(id, {
        from, to, limit,
        severity: parseFilter(request.query.severity),
        host: parseFilter(request.query.host),
        program: parseFilter(request.query.program),
        service: parseFilter(request.query.service),
        facility: parseFilter(request.query.facility),
      });
      return reply.send(events);
    },
  );

  // ── Drill-down: meta for a system (specific window) ────────
  app.get<{ Params: { id: string }; Querystring: { window_id?: string } }>(
    '/api/v1/systems/:id/meta',
    { preHandler: requireAuth(PERMISSIONS.DASHBOARD_VIEW) },
    async (request, reply) => {
      const { id } = request.params;

      let windowId = request.query.window_id;

      if (!windowId) {
        // Get latest window for this system
        const latestWindow = await db('windows')
          .where({ system_id: id })
          .orderBy('to_ts', 'desc')
          .first();
        windowId = latestWindow?.id;
      }

      if (!windowId) {
        return reply.code(404).send({ error: 'No windows found for this system' });
      }

      const meta = await db('meta_results').where({ window_id: windowId }).first();
      if (!meta) {
        return reply.code(404).send({ error: 'No meta result for this window' });
      }

      // Parse JSON fields safely (corrupted data shouldn't crash the endpoint)
      const safeJsonParse = (val: unknown) => {
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
        return val;
      };
      return reply.send({
        ...meta,
        meta_scores: safeJsonParse(meta.meta_scores),
        findings: safeJsonParse(meta.findings),
        key_event_ids: meta.key_event_ids ? safeJsonParse(meta.key_event_ids) : null,
      });
    },
  );

  // ── Findings: persistent, per-system findings with acknowledge ──

  // List findings for a system, filterable by status
  app.get<{
    Params: { id: string };
    Querystring: { status?: string; limit?: string };
  }>(
    '/api/v1/systems/:id/findings',
    { preHandler: requireAuth(PERMISSIONS.DASHBOARD_VIEW) },
    async (request, reply) => {
      const { id } = request.params;
      const statusFilter = request.query.status; // 'open', 'acknowledged', 'resolved', or 'active' (open+acknowledged)
      const rawLimit = Number(request.query.limit ?? 100);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 500) : 100;

      let query = db('findings')
        .where({ system_id: id })
        .orderBy('created_at', 'desc')
        .limit(limit);

      if (statusFilter === 'active') {
        // Active = open + acknowledged (not resolved)
        query = query.whereIn('status', ['open', 'acknowledged']);
      } else if (statusFilter && ['open', 'acknowledged', 'resolved'].includes(statusFilter)) {
        query = query.where({ status: statusFilter });
      }

      const rows = await query.select('*');
      return reply.send(rows);
    },
  );

  // Acknowledge a finding
  app.put<{ Params: { findingId: string } }>(
    '/api/v1/findings/:findingId/acknowledge',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_ACKNOWLEDGE) },
    async (request, reply) => {
      const { findingId } = request.params;

      const finding = await db('findings').where({ id: findingId }).first();
      if (!finding) {
        return reply.code(404).send({ error: 'Finding not found' });
      }
      if (finding.status === 'resolved') {
        return reply.code(400).send({ error: 'Cannot acknowledge a resolved finding' });
      }

      const now = new Date().toISOString();
      await db('findings')
        .where({ id: findingId })
        .update({
          status: 'acknowledged',
          acknowledged_at: now,
          acknowledged_by: request.currentUser?.username ?? request.apiKey?.name ?? 'system',
        });

      await writeAuditLog(db, {
        action: 'finding_acknowledge',
        resource_type: 'finding',
        resource_id: findingId,
        details: { previous_status: finding.status },
        ip: request.ip,
        user_id: request.currentUser?.id,
        session_id: request.currentSession?.id,
      });

      const updated = await db('findings').where({ id: findingId }).first();
      return reply.send(updated);
    },
  );

  // Re-open an acknowledged finding (undo)
  app.put<{ Params: { findingId: string } }>(
    '/api/v1/findings/:findingId/reopen',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_ACKNOWLEDGE) },
    async (request, reply) => {
      const { findingId } = request.params;

      const finding = await db('findings').where({ id: findingId }).first();
      if (!finding) {
        return reply.code(404).send({ error: 'Finding not found' });
      }
      if (finding.status !== 'acknowledged') {
        return reply.code(400).send({ error: 'Only acknowledged findings can be reopened' });
      }

      await db('findings')
        .where({ id: findingId })
        .update({
          status: 'open',
          acknowledged_at: null,
          acknowledged_by: null,
        });

      await writeAuditLog(db, {
        action: 'finding_reopen',
        resource_type: 'finding',
        resource_id: findingId,
        details: {},
        ip: request.ip,
        user_id: request.currentUser?.id,
        session_id: request.currentSession?.id,
      });

      const updated = await db('findings').where({ id: findingId }).first();
      return reply.send(updated);
    },
  );

  // ── SSE: score updates stream ──────────────────────────────
  app.get(
    '/api/v1/scores/stream',
    { preHandler: requireAuth(PERMISSIONS.DASHBOARD_VIEW) },
    async (request, reply) => {
      // Hijack the reply so Fastify does not try to manage the response
      reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial data
      try {
        const systems = await db('monitored_systems').select('id', 'name');
        reply.raw.write(`data: ${JSON.stringify({ type: 'init', systems })}\n\n`);
      } catch (err) {
        app.log.error(`[${localTimestamp()}] SSE init error: ${err}`);
      }

      // Poll for updates every 15s
      let intervalCleared = false;
      const interval = setInterval(async () => {
        if (intervalCleared) return;
        try {
          if (request.raw.destroyed) {
            intervalCleared = true;
            clearInterval(interval);
            return;
          }

          const since = new Date(Date.now() - 30_000).toISOString();

          const recentMeta = await db('meta_results')
            .where('created_at', '>=', since)
            .join('windows', 'meta_results.window_id', 'windows.id')
            .select('windows.system_id', 'meta_results.window_id', 'meta_results.meta_scores', 'meta_results.summary');

          // Re-check after async DB query (client may have disconnected during query)
          if (request.raw.destroyed) {
            intervalCleared = true;
            clearInterval(interval);
            return;
          }

          if (recentMeta.length > 0) {
            const sseJsonParse = (val: unknown) => {
              if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
              return val;
            };
            const payload = recentMeta.map((m: any) => ({
              system_id: m.system_id,
              window_id: m.window_id,
              meta_scores: sseJsonParse(m.meta_scores),
              summary: m.summary,
            }));
            reply.raw.write(`data: ${JSON.stringify({ type: 'update', results: payload })}\n\n`);
          } else {
            // Heartbeat
            reply.raw.write(`: heartbeat\n\n`);
          }
        } catch (err) {
          // Client may have disconnected or DB error
          if (request.raw.destroyed) {
            intervalCleared = true;
            clearInterval(interval);
          } else {
            app.log.error(`[${localTimestamp()}] SSE poll error: ${err}`);
          }
        }
      }, 15_000);

      request.raw.on('close', () => {
        intervalCleared = true;
        clearInterval(interval);
      });
    },
  );
}
