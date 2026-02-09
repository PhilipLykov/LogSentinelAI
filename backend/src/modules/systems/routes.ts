import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { localTimestamp } from '../../config/index.js';
import type { CreateSystemBody, UpdateSystemBody } from '../../types/index.js';

/**
 * CRUD for monitored_systems.
 * Auth: admin scope required. Parameterized queries only (A03).
 */
export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── LIST ────────────────────────────────────────────────────
  app.get(
    '/api/v1/systems',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (_request, reply) => {
      const systems = await db('monitored_systems').orderBy('name').select('*');
      return reply.send(systems);
    },
  );

  // ── GET BY ID ───────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/v1/systems/:id',
    { preHandler: requireAuth('admin', 'read', 'dashboard') },
    async (request, reply) => {
      const system = await db('monitored_systems').where({ id: request.params.id }).first();
      if (!system) return reply.code(404).send({ error: 'System not found' });
      return reply.send(system);
    },
  );

  // ── CREATE ──────────────────────────────────────────────────
  app.post<{ Body: CreateSystemBody }>(
    '/api/v1/systems',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      const { name, description, retention_days } = request.body ?? {};

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({ error: '"name" is required and must be a non-empty string.' });
      }

      // Validate retention_days if provided
      if (retention_days !== undefined && retention_days !== null) {
        const rd = Number(retention_days);
        if (!Number.isFinite(rd) || rd < 0 || rd > 3650) {
          return reply.code(400).send({ error: '"retention_days" must be 0–3650 (0 = keep forever, null = use global default).' });
        }
      }

      const id = uuidv4();
      const now = new Date().toISOString();

      await db('monitored_systems').insert({
        id,
        name: name.trim(),
        description: (description ?? '').trim(),
        retention_days: retention_days !== undefined ? retention_days : null,
        created_at: now,
        updated_at: now,
      });

      app.log.info(`[${localTimestamp()}] System created: id=${id}, name="${name}"`);
      const created = await db('monitored_systems').where({ id }).first();
      return reply.code(201).send(created);
    },
  );

  // ── UPDATE ──────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: UpdateSystemBody }>(
    '/api/v1/systems/:id',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await db('monitored_systems').where({ id }).first();
      if (!existing) return reply.code(404).send({ error: 'System not found' });

      const { name, description, retention_days } = request.body ?? {};
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return reply.code(400).send({ error: '"name" must be a non-empty string.' });
        }
        updates.name = name.trim();
      }
      if (description !== undefined) {
        updates.description = (typeof description === 'string' ? description : '').trim();
      }
      if (retention_days !== undefined) {
        if (retention_days === null) {
          updates.retention_days = null;
        } else {
          const rd = Number(retention_days);
          if (!Number.isFinite(rd) || rd < 0 || rd > 3650) {
            return reply.code(400).send({ error: '"retention_days" must be 0–3650 (0 = keep forever, null = use global default).' });
          }
          updates.retention_days = rd;
        }
      }

      await db('monitored_systems').where({ id }).update(updates);

      app.log.info(`[${localTimestamp()}] System updated: id=${id}`);
      const updated = await db('monitored_systems').where({ id }).first();
      return reply.send(updated);
    },
  );

  // ── DELETE ──────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/v1/systems/:id',
    { preHandler: requireAuth('admin') },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await db('monitored_systems').where({ id }).first();
      if (!existing) return reply.code(404).send({ error: 'System not found' });

      // Cascade delete related data to avoid orphaned records
      await db.transaction(async (trx) => {
        // Delete effective scores (depends on windows)
        await trx('effective_scores').where({ system_id: id }).del();
        // Delete meta results (depends on windows)
        const windowIds = await trx('windows').where({ system_id: id }).pluck('id');
        if (windowIds.length > 0) {
          // Batch the whereIn to avoid hitting SQL parameter limits on large datasets
          for (let i = 0; i < windowIds.length; i += 500) {
            await trx('meta_results').whereIn('window_id', windowIds.slice(i, i + 500)).del();
          }
        }
        // Delete alert_history for this system (explicit — don't rely on FK CASCADE alone)
        await trx('alert_history').where({ system_id: id }).del();
        // Delete windows
        await trx('windows').where({ system_id: id }).del();
        // Delete event scores (depends on events)
        const eventIds = await trx('events').where({ system_id: id }).pluck('id');
        if (eventIds.length > 0) {
          for (let i = 0; i < eventIds.length; i += 500) {
            await trx('event_scores').whereIn('event_id', eventIds.slice(i, i + 500)).del();
          }
        }
        // Delete events
        await trx('events').where({ system_id: id }).del();
        // Delete log sources
        await trx('log_sources').where({ system_id: id }).del();
        // Delete message templates
        await trx('message_templates').where({ system_id: id }).del();
        // Delete the system itself
        await trx('monitored_systems').where({ id }).del();
      });

      app.log.info(`[${localTimestamp()}] System deleted (with cascade): id=${id}`);
      return reply.code(204).send();
    },
  );
}
