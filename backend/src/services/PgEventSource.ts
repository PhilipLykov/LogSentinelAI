/**
 * PostgreSQL implementation of EventSource.
 *
 * Extracts all event-related Knex queries from route handlers and pipeline
 * modules into a single cohesive class. Route handlers and pipeline jobs
 * delegate to this class via the EventSource interface.
 */

import type { Knex } from 'knex';
import { getDb } from '../db/index.js';
import type {
  EventSource,
  LogEvent,
  EventSearchFilters,
  EventSearchResult,
  EventFacets,
  TraceResult,
  AckFilters,
  BulkDeleteFilters,
  BulkDeleteResult,
} from './EventSource.js';

// ── Constants ────────────────────────────────────────────────────

const ALLOWED_SORT_COLUMNS = new Set([
  'timestamp', 'severity', 'host', 'source_ip', 'program', 'service',
]);

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const FACET_LIMIT = 200;

// ── Helpers ──────────────────────────────────────────────────────

/** Escape LIKE/ILIKE wildcards to prevent pattern injection. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

/** Parse raw JSON field safely. */
function parseRawField(raw: unknown): unknown {
  if (raw && typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { /* keep as string */ }
  }
  return raw;
}

/** Normalise a result row (parse raw JSON). */
function normaliseRow(row: any): LogEvent {
  return { ...row, raw: parseRawField(row.raw) };
}

// ── Select columns used by search queries ────────────────────────

const SEARCH_COLUMNS = [
  'events.id',
  'events.system_id',
  'monitored_systems.name as system_name',
  'events.log_source_id',
  'events.timestamp',
  'events.received_at',
  'events.message',
  'events.severity',
  'events.host',
  'events.source_ip',
  'events.service',
  'events.program',
  'events.facility',
  'events.trace_id',
  'events.span_id',
  'events.external_id',
  'events.raw',
  'events.acknowledged_at',
];

const TRACE_COLUMNS = [
  'events.id',
  'events.system_id',
  'monitored_systems.name as system_name',
  'events.timestamp',
  'events.message',
  'events.severity',
  'events.host',
  'events.source_ip',
  'events.program',
  'events.service',
  'events.trace_id',
  'events.span_id',
  'events.external_id',
  'events.raw',
];

// ── Implementation ───────────────────────────────────────────────

export class PgEventSource implements EventSource {
  private db: Knex;

  constructor(db?: Knex) {
    this.db = db ?? getDb();
  }

  // ── Search & retrieval ─────────────────────────────────────

  async searchEvents(filters: EventSearchFilters): Promise<EventSearchResult> {
    const {
      q, q_mode, system_id, severity, host, source_ip,
      program, service, trace_id, from, to,
    } = filters;

    const rawPage = filters.page ?? 1;
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const rawLimit = filters.limit ?? DEFAULT_LIMIT;
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    const sortColumn = ALLOWED_SORT_COLUMNS.has(filters.sort_by ?? '') ? filters.sort_by! : 'timestamp';
    const sortDirection = filters.sort_dir === 'asc' ? 'asc' : 'desc';

    // Build base query
    const baseQuery = this.db('events')
      .join('monitored_systems', 'events.system_id', 'monitored_systems.id');

    if (system_id) baseQuery.where('events.system_id', system_id);

    if (severity) {
      const severities = severity.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
      if (severities.length > 0) {
        baseQuery.whereRaw(
          `LOWER(events.severity) IN (${severities.map(() => '?').join(', ')})`,
          severities,
        );
      }
    }

    if (host) baseQuery.where('events.host', host);
    if (source_ip) baseQuery.where('events.source_ip', source_ip);
    if (program) baseQuery.where('events.program', program);
    if (service) baseQuery.where('events.service', service);
    if (trace_id) baseQuery.where('events.trace_id', trace_id);
    if (from && !isNaN(Date.parse(from))) baseQuery.where('events.timestamp', '>=', from);
    if (to && !isNaN(Date.parse(to))) baseQuery.where('events.timestamp', '<=', to);

    // Full-text search
    if (q && q.trim().length > 0) {
      const trimmed = q.trim();
      if (q_mode === 'contains') {
        baseQuery.where('events.message', 'ILIKE', `%${escapeLike(trimmed)}%`);
      } else {
        baseQuery.whereRaw(
          `to_tsvector('english', events.message) @@ websearch_to_tsquery('english', ?)`,
          [trimmed],
        );
      }
    }

    // Count total
    const countResult = await baseQuery.clone().clearSelect().clearOrder()
      .count('events.id as total').first();
    const total = Number(countResult?.total ?? 0);

    // Fetch page
    const rows = await baseQuery.clone()
      .select(...SEARCH_COLUMNS)
      .orderBy(`events.${sortColumn}`, sortDirection)
      .orderBy('events.id', 'asc')
      .limit(limit)
      .offset(offset);

    return {
      events: rows.map(normaliseRow),
      total,
      page,
      limit,
      has_more: offset + limit < total,
    };
  }

  async getFacets(systemId: string | undefined, days: number): Promise<EventFacets> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const baseWhere = (col: string) => {
      const q = this.db('events')
        .where('events.timestamp', '>=', since)
        .whereNotNull(col)
        .where(col, '!=', '');
      if (systemId) q.where('events.system_id', systemId);
      return q;
    };

    const [severities, hosts, sourceIps, programs] = await Promise.all([
      baseWhere('events.severity').distinct('events.severity as value').orderBy('value').limit(FACET_LIMIT),
      baseWhere('events.host').distinct('events.host as value').orderBy('value').limit(FACET_LIMIT),
      baseWhere('events.source_ip').distinct('events.source_ip as value').orderBy('value').limit(FACET_LIMIT),
      baseWhere('events.program').distinct('events.program as value').orderBy('value').limit(FACET_LIMIT),
    ]);

    return {
      severities: severities.map((r: any) => r.value),
      hosts: hosts.map((r: any) => r.value),
      source_ips: sourceIps.map((r: any) => r.value),
      programs: programs.map((r: any) => r.value),
    };
  }

  async traceEvents(
    value: string,
    field: 'trace_id' | 'message' | 'all',
    fromTs: string,
    toTs: string,
    limit: number,
  ): Promise<TraceResult> {
    const query = this.db('events')
      .join('monitored_systems', 'events.system_id', 'monitored_systems.id')
      .where('events.timestamp', '>=', fromTs)
      .where('events.timestamp', '<=', toTs);

    if (field === 'trace_id') {
      query.where('events.trace_id', value);
    } else if (field === 'message') {
      query.where('events.message', 'ILIKE', `%${escapeLike(value)}%`);
    } else {
      query.where(function () {
        this.where('events.trace_id', value)
          .orWhere('events.span_id', value)
          .orWhere('events.message', 'ILIKE', `%${escapeLike(value)}%`);
      });
    }

    const rows = await query.select(...TRACE_COLUMNS).orderBy('events.timestamp', 'asc').limit(limit);

    return {
      events: rows.map(normaliseRow),
      total: rows.length,
    };
  }

  async getSystemEvents(
    systemId: string,
    opts: { from?: string; to?: string; limit: number },
  ): Promise<LogEvent[]> {
    let query = this.db('events')
      .where({ system_id: systemId })
      .orderBy('timestamp', 'desc')
      .limit(opts.limit);

    if (opts.from) query = query.where('timestamp', '>=', opts.from);
    if (opts.to) query = query.where('timestamp', '<=', opts.to);

    const rows = await query.select('*');
    return rows.map(normaliseRow);
  }

  async countSystemEvents(systemId: string, since: string): Promise<number> {
    const result = await this.db('events')
      .where({ system_id: systemId })
      .where('timestamp', '>=', since)
      .count('id as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  // ── AI pipeline ────────────────────────────────────────────

  async getUnscoredEvents(
    systemId: string | undefined,
    limit: number,
  ): Promise<LogEvent[]> {
    let query = this.db('events')
      .leftJoin('event_scores', 'events.id', 'event_scores.event_id')
      .whereNull('event_scores.id')
      .whereNull('events.acknowledged_at')
      .select(
        'events.id', 'events.system_id', 'events.message', 'events.severity',
        'events.host', 'events.program', 'events.log_source_id',
      )
      .limit(limit);

    if (systemId) {
      query = query.where('events.system_id', systemId);
    }

    return query;
  }

  async getEventsInTimeRange(
    systemId: string,
    fromTs: string,
    toTs: string,
    opts?: { limit?: number; excludeAcknowledged?: boolean },
  ): Promise<LogEvent[]> {
    let query = this.db('events')
      .where({ system_id: systemId })
      .where('timestamp', '>=', fromTs)
      .where('timestamp', '<', toTs)
      .select('id', 'message', 'severity', 'template_id', 'acknowledged_at')
      .orderBy('timestamp', 'asc');

    if (opts?.limit) query = query.limit(opts.limit);
    if (opts?.excludeAcknowledged) query = query.whereNull('acknowledged_at');

    return query;
  }

  async countEventsInTimeRange(
    systemId: string,
    fromTs: string,
    toTs: string,
  ): Promise<number> {
    const result = await this.db('events')
      .where({ system_id: systemId })
      .where('timestamp', '>=', fromTs)
      .where('timestamp', '<', toTs)
      .count('id as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  // ── Acknowledgment ─────────────────────────────────────────

  async acknowledgeEvents(filters: AckFilters): Promise<number> {
    const BATCH_SIZE = 5000;
    let totalAcked = 0;
    const ackTs = new Date().toISOString();

    // Count first
    let countQ = this.db('events').whereNull('acknowledged_at').where('timestamp', '<=', filters.to);
    if (filters.from) countQ = countQ.where('timestamp', '>=', filters.from);
    if (filters.system_id) countQ = countQ.where('system_id', filters.system_id);
    const countResult = await countQ.count('id as cnt').first();
    const total = Number(countResult?.cnt ?? 0);

    if (total === 0) return 0;

    while (totalAcked < total) {
      let batchQ = this.db('events').whereNull('acknowledged_at').where('timestamp', '<=', filters.to);
      if (filters.from) batchQ = batchQ.where('timestamp', '>=', filters.from);
      if (filters.system_id) batchQ = batchQ.where('system_id', filters.system_id);

      const ids = await batchQ.select('id').limit(BATCH_SIZE);
      if (ids.length === 0) break;

      await this.db('events')
        .whereIn('id', ids.map((r: any) => r.id))
        .update({ acknowledged_at: ackTs });

      totalAcked += ids.length;
    }

    return totalAcked;
  }

  async unacknowledgeEvents(filters: AckFilters): Promise<number> {
    let query = this.db('events')
      .whereNotNull('acknowledged_at')
      .where('timestamp', '<=', filters.to);
    if (filters.from) query = query.where('timestamp', '>=', filters.from);
    if (filters.system_id) query = query.where('system_id', filters.system_id);

    return query.update({ acknowledged_at: null });
  }

  // ── Maintenance & admin ────────────────────────────────────

  async deleteOldEvents(systemId: string, cutoffIso: string): Promise<BulkDeleteResult> {
    let totalEventsDeleted = 0;
    let totalScoresDeleted = 0;

    let hasMore = true;
    while (hasMore) {
      const oldEventIds = await this.db('events')
        .where({ system_id: systemId })
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
        const deleted = await this.db('event_scores').whereIn('event_id', chunk).del();
        totalScoresDeleted += deleted;
      }

      // Delete the events
      const eventsDeleted = await this.db('events').whereIn('id', oldEventIds).del();
      totalEventsDeleted += eventsDeleted;

      if (oldEventIds.length < 1000) hasMore = false;
    }

    return { deleted_events: totalEventsDeleted, deleted_scores: totalScoresDeleted };
  }

  async bulkDeleteEvents(filters: BulkDeleteFilters): Promise<BulkDeleteResult> {
    let totalEventsDeleted = 0;
    let totalScoresDeleted = 0;

    let hasMore = true;
    while (hasMore) {
      let idQuery = this.db('events').limit(1000);
      if (filters.from) idQuery = idQuery.where('timestamp', '>=', filters.from);
      if (filters.to) idQuery = idQuery.where('timestamp', '<=', filters.to);
      if (filters.system_id) idQuery = idQuery.where({ system_id: filters.system_id });

      const eventIds = await idQuery.pluck('id');
      if (eventIds.length === 0) { hasMore = false; break; }

      // Delete event_scores first
      for (let i = 0; i < eventIds.length; i += 500) {
        const chunk = eventIds.slice(i, i + 500);
        const scoresDeleted = await this.db('event_scores').whereIn('event_id', chunk).del();
        totalScoresDeleted += scoresDeleted;
      }

      const eventsDeleted = await this.db('events').whereIn('id', eventIds).del();
      totalEventsDeleted += eventsDeleted;

      if (eventIds.length < 1000) hasMore = false;
    }

    return { deleted_events: totalEventsDeleted, deleted_scores: totalScoresDeleted };
  }

  async totalEventCount(): Promise<number> {
    const result = await this.db('events').count('id as cnt').first();
    return Number(result?.cnt ?? 0);
  }

  async cascadeDeleteSystem(systemId: string, trx: unknown): Promise<void> {
    const t = trx as Knex.Transaction;

    // Delete event scores (depends on events)
    const eventIds = await t('events').where({ system_id: systemId }).pluck('id');
    if (eventIds.length > 0) {
      for (let i = 0; i < eventIds.length; i += 500) {
        await t('event_scores').whereIn('event_id', eventIds.slice(i, i + 500)).del();
      }
    }
    // Delete events
    await t('events').where({ system_id: systemId }).del();
  }
}
