import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { CRITERIA } from '../../types/index.js';
import { localTimestamp } from '../../config/index.js';

/**
 * Dashboard-oriented API routes: system overview, drill-down, SSE stream.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── Dashboard overview: systems with latest effective scores ─
  app.get(
    '/api/v1/dashboard/systems',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (_request, reply) => {
      const systems = await db('monitored_systems').orderBy('name').select('*');

      const result = [];
      for (const system of systems) {
        // Latest window for this system
        const latestWindow = await db('windows')
          .where({ system_id: system.id })
          .orderBy('to_ts', 'desc')
          .first();

        let scores: Record<string, { effective: number; meta: number; max_event: number }> = {};

        if (latestWindow) {
          const effectiveRows = await db('effective_scores')
            .where({ window_id: latestWindow.id, system_id: system.id })
            .select('criterion_id', 'effective_value', 'meta_score', 'max_event_score');

          for (const row of effectiveRows) {
            const criterion = CRITERIA.find((c) => c.id === row.criterion_id);
            if (criterion) {
              scores[criterion.slug] = {
                effective: row.effective_value,
                meta: row.meta_score,
                max_event: row.max_event_score,
              };
            }
          }
        }

        // Source count
        const sourceCount = await db('log_sources')
          .where({ system_id: system.id })
          .count('id as cnt')
          .first();

        // Event count (last 24h)
        const eventCount = await db('events')
          .where({ system_id: system.id })
          .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .count('id as cnt')
          .first();

        result.push({
          id: system.id,
          name: system.name,
          description: system.description,
          source_count: Number(sourceCount?.cnt ?? 0),
          event_count_24h: Number(eventCount?.cnt ?? 0),
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
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string; limit?: string } }>(
    '/api/v1/systems/:id/events',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      const { id } = request.params;
      const { from, to } = request.query;
      const rawLimit = Number(request.query.limit ?? 100);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 500) : 100;

      let query = db('events')
        .where({ system_id: id })
        .orderBy('timestamp', 'desc')
        .limit(limit);

      if (from) query = query.where('timestamp', '>=', from);
      if (to) query = query.where('timestamp', '<=', to);

      const events = await query.select('*');

      // Parse raw JSON (try/catch per row to avoid one corrupt row crashing the endpoint)
      const result = events.map((e: any) => {
        let raw = e.raw;
        if (raw && typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch { /* keep as string */ }
        }
        return { ...e, raw };
      });

      return reply.send(result);
    },
  );

  // ── Drill-down: meta for a system (specific window) ────────
  app.get<{ Params: { id: string }; Querystring: { window_id?: string } }>(
    '/api/v1/systems/:id/meta',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
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

  // ── SSE: score updates stream ──────────────────────────────
  app.get(
    '/api/v1/scores/stream',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
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
