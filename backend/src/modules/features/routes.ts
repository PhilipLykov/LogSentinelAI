import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { generateComplianceExport, type ExportParams } from './exportCompliance.js';
import { askQuestion } from './rag.js';

/**
 * Phase 7 feature routes: compliance export, RAG query, app config, cost visibility.
 */
export async function registerFeaturesRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── Compliance export ──────────────────────────────────────
  app.post<{ Body: ExportParams }>(
    '/api/v1/export/compliance',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      const { type, system_ids, from, to } = request.body ?? {} as any;

      if (!from || !to) {
        return reply.code(400).send({ error: '"from" and "to" are required.' });
      }

      // Validate date strings
      if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
        return reply.code(400).send({ error: '"from" and "to" must be valid ISO date strings.' });
      }

      const validTypes = ['csv', 'json'];
      if (!validTypes.includes(type)) {
        return reply.code(400).send({ error: `type must be one of: ${validTypes.join(', ')}` });
      }

      const { data, filename } = await generateComplianceExport(db, {
        type,
        system_ids,
        from,
        to,
      });

      const contentType = type === 'json' ? 'application/json' : 'text/csv';
      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(data);
    },
  );

  // ── RAG query ──────────────────────────────────────────────
  app.post<{ Body: { question: string; system_id?: string; from?: string; to?: string } }>(
    '/api/v1/ask',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      const { question, system_id, from, to } = request.body ?? {} as any;

      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return reply.code(400).send({ error: '"question" is required.' });
      }

      try {
        const result = await askQuestion(db, question, { systemId: system_id, from, to });
        return reply.send(result);
      } catch (err: any) {
        // askQuestion already sanitizes the error message for the client
        return reply.code(500).send({ error: err.message ?? 'Internal error processing question.' });
      }
    },
  );

  // ── App config (get/set) ───────────────────────────────────
  app.get(
    '/api/v1/config',
    { preHandler: requireAuth('admin') },
    async (_req, reply) => {
      const rows = await db('app_config').select('*');
      const config: Record<string, unknown> = {};
      for (const row of rows) {
        if (typeof row.value === 'string') {
          try { config[row.key] = JSON.parse(row.value); } catch { config[row.key] = row.value; }
        } else {
          config[row.key] = row.value;
        }
      }
      return reply.send(config);
    },
  );

  app.put<{ Body: { key: string; value: unknown } }>(
    '/api/v1/config',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      const { key, value } = request.body ?? {} as any;

      if (!key || value === undefined) {
        return reply.code(400).send({ error: '"key" and "value" are required.' });
      }

      await db.raw(`
        INSERT INTO app_config (key, value) VALUES (?, ?::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [key, JSON.stringify(value)]);

      return reply.send({ key, value });
    },
  );

  // ── Cost visibility ────────────────────────────────────────
  app.get<{ Querystring: { from?: string; to?: string; system_id?: string; group_by?: string } }>(
    '/api/v1/costs',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      const { from, to, system_id, group_by } = request.query;

      // Aggregate costs
      let query = db('llm_usage');
      if (from) query = query.where('created_at', '>=', from);
      if (to) query = query.where('created_at', '<=', to);
      if (system_id) query = query.where({ system_id });

      const totals = await query
        .select(db.raw("COALESCE(run_type, 'all') as run_type"))
        .sum('token_input as total_input')
        .sum('token_output as total_output')
        .sum('request_count as total_requests')
        .sum('event_count as total_events')
        .count('id as record_count')
        .groupBy('run_type');

      // Per-day breakdown if requested
      let daily: any[] = [];
      if (group_by === 'day') {
        let dayQuery = db('llm_usage')
          .select(db.raw("DATE(created_at) as day"))
          .sum('token_input as input')
          .sum('token_output as output')
          .sum('request_count as requests')
          .groupBy(db.raw("DATE(created_at)"))
          .orderBy('day', 'desc')
          .limit(30);

        if (from) dayQuery = dayQuery.where('created_at', '>=', from);
        if (to) dayQuery = dayQuery.where('created_at', '<=', to);
        if (system_id) dayQuery = dayQuery.where({ system_id });

        daily = await dayQuery;
      }

      return reply.send({ totals, daily });
    },
  );
}
