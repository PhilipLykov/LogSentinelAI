/**
 * Factory for obtaining the correct EventSource implementation
 * based on the monitored system's configuration.
 *
 * - PgEventSource  → default; events stored in PostgreSQL
 * - EsEventSource  → events read from Elasticsearch, metadata in PG
 */

import type { Knex } from 'knex';
import type { EventSource } from './EventSource.js';
import { PgEventSource } from './PgEventSource.js';
import { EsEventSource } from './EsEventSource.js';
import type { EsSystemConfig } from '../types/index.js';

/** Minimal system shape — avoids importing the full MonitoredSystem type. */
interface SystemLike {
  id?: string;
  event_source?: string;
  es_config?: Record<string, unknown> | null;
  es_connection_id?: string | null;
}

/**
 * Return the appropriate EventSource for a given system.
 *
 * @param system  The monitored system row (may include `event_source`).
 * @param db      Optional Knex instance (defaults to the global singleton).
 */
export function getEventSource(system?: SystemLike | null, db?: Knex): EventSource {
  if (
    system?.event_source === 'elasticsearch' &&
    system.id &&
    system.es_connection_id &&
    system.es_config
  ) {
    return new EsEventSource(
      system.id,
      system.es_connection_id,
      system.es_config as unknown as EsSystemConfig,
      db,
    );
  }
  return new PgEventSource(db);
}

/** Convenience: get the default PgEventSource (no system context needed). */
export function getDefaultEventSource(db?: Knex): EventSource {
  return new PgEventSource(db);
}
