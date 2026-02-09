import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { CRITERIA } from '../../types/index.js';

/**
 * Scores API — exposes effective scores, event scores, and meta results.
 * Auth: read, dashboard, or admin scope. Parameterized queries (A03).
 */
export async function registerScoresRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── Effective scores per system (latest window) ────────────
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/v1/scores/systems',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      const { from, to } = request.query;

      // Get latest window per system
      let windowQuery = db('windows')
        .select('windows.*')
        .distinctOn('system_id')
        .orderBy('system_id')
        .orderBy('to_ts', 'desc');

      if (from) windowQuery = windowQuery.where('from_ts', '>=', from);
      if (to) windowQuery = windowQuery.where('to_ts', '<=', to);

      const latestWindows = await windowQuery;

      const results = [];

      for (const w of latestWindows) {
        const system = await db('monitored_systems').where({ id: w.system_id }).first();

        const scores = await db('effective_scores')
          .where({ window_id: w.id, system_id: w.system_id })
          .select('criterion_id', 'effective_value', 'meta_score', 'max_event_score');

        const scoreMap: Record<string, { effective: number; meta: number; max_event: number }> = {};
        for (const s of scores) {
          const criterion = CRITERIA.find((c) => c.id === s.criterion_id);
          if (criterion) {
            scoreMap[criterion.slug] = {
              effective: s.effective_value,
              meta: s.meta_score,
              max_event: s.max_event_score,
            };
          }
        }

        results.push({
          system_id: w.system_id,
          system_name: system?.name ?? 'Unknown',
          window_id: w.id,
          window_from: w.from_ts,
          window_to: w.to_ts,
          scores: scoreMap,
          updated_at: w.created_at,
        });
      }

      return reply.send(results);
    },
  );

  // ── Event scores for a specific event ──────────────────────
  app.get<{ Params: { eventId: string } }>(
    '/api/v1/events/:eventId/scores',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      const scores = await db('event_scores')
        .where({ event_id: request.params.eventId })
        .join('criteria', 'event_scores.criterion_id', 'criteria.id')
        .select(
          'criteria.slug',
          'criteria.name',
          'event_scores.score',
          'event_scores.score_type',
          'event_scores.severity_label',
          'event_scores.reason_codes',
        );

      if (scores.length === 0) {
        return reply.code(404).send({ error: 'No scores found for this event' });
      }

      return reply.send(scores);
    },
  );

  // ── Meta result for a window ───────────────────────────────
  app.get<{ Params: { windowId: string } }>(
    '/api/v1/windows/:windowId/meta',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      const meta = await db('meta_results')
        .where({ window_id: request.params.windowId })
        .first();

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

  // ── Windows for a system ───────────────────────────────────
  app.get<{ Querystring: { system_id?: string; from?: string; to?: string; limit?: string } }>(
    '/api/v1/windows',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      let query = db('windows').orderBy('to_ts', 'desc');

      if (request.query.system_id) query = query.where({ system_id: request.query.system_id });
      if (request.query.from) query = query.where('from_ts', '>=', request.query.from);
      if (request.query.to) query = query.where('to_ts', '<=', request.query.to);

      const rawLimit = Number(request.query.limit ?? 50);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 200) : 50;
      query = query.limit(limit);

      const windows = await query.select('*');
      return reply.send(windows);
    },
  );

  // ── LLM usage stats ───────────────────────────────────────
  app.get<{ Querystring: { from?: string; to?: string; system_id?: string } }>(
    '/api/v1/llm-usage',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      let query = db('llm_usage').orderBy('created_at', 'desc').limit(100);

      if (request.query.from) query = query.where('created_at', '>=', request.query.from);
      if (request.query.to) query = query.where('created_at', '<=', request.query.to);
      if (request.query.system_id) query = query.where({ system_id: request.query.system_id });

      const usage = await query.select('*');

      // Totals — apply same filters so totals match the records
      let totalsQuery = db('llm_usage');
      if (request.query.from) totalsQuery = totalsQuery.where('created_at', '>=', request.query.from);
      if (request.query.to) totalsQuery = totalsQuery.where('created_at', '<=', request.query.to);
      if (request.query.system_id) totalsQuery = totalsQuery.where({ system_id: request.query.system_id });

      const totals = await totalsQuery
        .sum('token_input as total_input')
        .sum('token_output as total_output')
        .sum('request_count as total_requests')
        .first();

      return reply.send({ records: usage, totals });
    },
  );
}
