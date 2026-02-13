import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { PERMISSIONS } from '../../middleware/permissions.js';
import { writeAuditLog } from '../../middleware/audit.js';
import { localTimestamp } from '../../config/index.js';
import {
  generateNormalPattern,
  patternToRegex,
} from '../pipeline/normalBehavior.js';

/**
 * Normal Behavior Templates — CRUD API.
 *
 * Allows users to mark event patterns as "normal behavior" so they
 * are excluded from future AI scoring and meta-analysis.
 */
export async function registerNormalBehaviorRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  /** Load an event by ID directly from the events table. */
  async function loadEventById(eventId: string): Promise<{ id: string; message: string; system_id: string } | null> {
    const row = await db('events')
      .where({ id: eventId })
      .select('id', 'message', 'system_id')
      .first();
    return row ?? null;
  }

  // ── Preview: generate pattern from event ───────────────────
  app.post<{
    Body: { event_id?: string; message?: string };
  }>(
    '/api/v1/normal-behavior-templates/preview',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_ACKNOWLEDGE) },
    async (request, reply) => {
      const { event_id, message } = request.body ?? {};

      let originalMessage: string;

      if (event_id) {
        const event = await loadEventById(event_id);
        if (!event) {
          return reply.code(404).send({ error: 'Event not found' });
        }
        originalMessage = event.message;
      } else if (message && typeof message === 'string') {
        originalMessage = message;
      } else {
        return reply.code(400).send({ error: 'Provide event_id or message' });
      }

      const suggestedPattern = generateNormalPattern(originalMessage);

      return reply.send({
        original_message: originalMessage,
        suggested_pattern: suggestedPattern,
      });
    },
  );

  // ── Create template ────────────────────────────────────────
  app.post<{
    Body: {
      event_id?: string;
      system_id?: string | null;
      pattern?: string;
      message?: string;
      notes?: string;
    };
  }>(
    '/api/v1/normal-behavior-templates',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_ACKNOWLEDGE) },
    async (request, reply) => {
      const body = request.body ?? {};
      const username = request.currentUser?.username ?? request.apiKey?.name ?? 'system';

      let pattern: string;
      let originalMessage: string;
      let originalEventId: string | null = null;
      let systemId: string | null = body.system_id ?? null;

      if (body.event_id) {
        const event = await loadEventById(body.event_id);
        if (!event) {
          return reply.code(404).send({ error: 'Event not found' });
        }

        originalMessage = event.message;
        originalEventId = body.event_id;
        if (!systemId) systemId = event.system_id;
        pattern = body.pattern ?? generateNormalPattern(originalMessage);
      } else if (body.pattern) {
        pattern = body.pattern;
        originalMessage = body.message ?? body.pattern;
      } else {
        return reply.code(400).send({ error: 'Provide event_id or pattern' });
      }

      // Validate pattern
      const trimmedPattern = pattern.trim();
      if (!trimmedPattern) {
        return reply.code(400).send({ error: 'Pattern cannot be empty' });
      }
      if (trimmedPattern.length > 2000) {
        return reply.code(400).send({ error: 'Pattern is too long (max 2000 characters)' });
      }

      // Compile and validate regex
      let patternRegex: string;
      try {
        patternRegex = patternToRegex(trimmedPattern);
        new RegExp(patternRegex); // validate
      } catch {
        return reply.code(400).send({ error: 'Generated regex is invalid. Try simplifying the pattern.' });
      }

      const id = uuidv4();
      await db('normal_behavior_templates').insert({
        id,
        system_id: systemId,
        pattern: trimmedPattern,
        pattern_regex: patternRegex,
        original_message: originalMessage,
        original_event_id: originalEventId,
        created_by: username,
        enabled: true,
        notes: body.notes ?? null,
      });

      await writeAuditLog(db, {
        action: 'normal_behavior_template_create',
        resource_type: 'normal_behavior_template',
        resource_id: id,
        details: { pattern: trimmedPattern, system_id: systemId },
        ip: request.ip,
        user_id: request.currentUser?.id,
        session_id: request.currentSession?.id,
      });

      const created = await db('normal_behavior_templates').where({ id }).first();
      console.log(
        `[${localTimestamp()}] Normal behavior template created by ${username}: "${trimmedPattern}" (system=${systemId ?? 'global'})`,
      );

      return reply.code(201).send(created);
    },
  );

  // ── List templates ─────────────────────────────────────────
  app.get<{
    Querystring: { system_id?: string; enabled?: string };
  }>(
    '/api/v1/normal-behavior-templates',
    { preHandler: requireAuth(PERMISSIONS.DASHBOARD_VIEW) },
    async (request, reply) => {
      let query = db('normal_behavior_templates').orderBy('created_at', 'desc');

      if (request.query.system_id) {
        query = query.where(function () {
          this.where('system_id', request.query.system_id).orWhereNull('system_id');
        });
      }

      if (request.query.enabled === 'true') {
        query = query.where({ enabled: true });
      } else if (request.query.enabled === 'false') {
        query = query.where({ enabled: false });
      }

      const templates = await query.select('*');
      return reply.send(templates);
    },
  );

  // ── Update template ────────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: {
      pattern?: string;
      enabled?: boolean;
      notes?: string;
      system_id?: string | null;
    };
  }>(
    '/api/v1/normal-behavior-templates/:id',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_ACKNOWLEDGE) },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};

      const existing = await db('normal_behavior_templates').where({ id }).first();
      if (!existing) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      const updates: Record<string, unknown> = {};

      if (body.pattern !== undefined && body.pattern !== existing.pattern) {
        const trimmed = body.pattern.trim();
        if (!trimmed) {
          return reply.code(400).send({ error: 'Pattern cannot be empty' });
        }
        if (trimmed.length > 2000) {
          return reply.code(400).send({ error: 'Pattern is too long (max 2000 characters)' });
        }
        try {
          const regex = patternToRegex(trimmed);
          new RegExp(regex); // validate
          updates.pattern = trimmed;
          updates.pattern_regex = regex;
        } catch {
          return reply.code(400).send({ error: 'Generated regex is invalid. Try simplifying the pattern.' });
        }
      }

      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.system_id !== undefined) updates.system_id = body.system_id;

      if (Object.keys(updates).length === 0) {
        return reply.send(existing);
      }

      await db('normal_behavior_templates').where({ id }).update(updates);

      await writeAuditLog(db, {
        action: 'normal_behavior_template_update',
        resource_type: 'normal_behavior_template',
        resource_id: id,
        details: updates,
        ip: request.ip,
        user_id: request.currentUser?.id,
        session_id: request.currentSession?.id,
      });

      const updated = await db('normal_behavior_templates').where({ id }).first();
      return reply.send(updated);
    },
  );

  // ── Delete template ────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/v1/normal-behavior-templates/:id',
    { preHandler: requireAuth(PERMISSIONS.EVENTS_ACKNOWLEDGE) },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await db('normal_behavior_templates').where({ id }).first();
      if (!existing) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      await db('normal_behavior_templates').where({ id }).delete();

      await writeAuditLog(db, {
        action: 'normal_behavior_template_delete',
        resource_type: 'normal_behavior_template',
        resource_id: id,
        details: { pattern: existing.pattern, system_id: existing.system_id },
        ip: request.ip,
        user_id: request.currentUser?.id,
        session_id: request.currentSession?.id,
      });

      console.log(
        `[${localTimestamp()}] Normal behavior template deleted: "${existing.pattern}" (id=${id})`,
      );

      return reply.code(204).send();
    },
  );
}
