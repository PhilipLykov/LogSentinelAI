import type { Knex } from 'knex';

/**
 * Migration 021 — Elasticsearch integration support.
 *
 * Adds the infrastructure for hybrid event storage:
 *   1. `monitored_systems` gains `event_source` and `es_config` columns so
 *      each system can independently use PostgreSQL or Elasticsearch.
 *   2. `elasticsearch_connections` table stores global ES connection settings
 *      (URL, authentication, TLS, connection pooling) managed via the UI.
 *   3. `es_event_metadata` table stores lightweight PG-side metadata for ES
 *      events (acknowledgments, template links) that cannot be written into
 *      the read-only Elasticsearch documents.
 *   4. `event_scores.event_id` is widened from UUID to VARCHAR(255) to
 *      accommodate Elasticsearch `_id` values (base64-like strings, ~20 chars).
 *      The FK constraint was already dropped in migration 018 (partitioning).
 *
 * New permissions are added for ES management.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Extend monitored_systems ──────────────────────────────
  const hasEventSource = await knex.schema.hasColumn('monitored_systems', 'event_source');
  if (!hasEventSource) {
    await knex.schema.alterTable('monitored_systems', (t) => {
      t.string('event_source', 16).notNullable().defaultTo('postgresql');
      t.jsonb('es_config').nullable();      // index pattern, query filter, field mapping, etc.
      t.uuid('es_connection_id').nullable(); // FK to elasticsearch_connections.id
    });
    console.log('[Migration 021] Added event_source, es_config, es_connection_id to monitored_systems');
  }

  // ── 2. elasticsearch_connections table ────────────────────────
  const hasEsConns = await knex.schema.hasTable('elasticsearch_connections');
  if (!hasEsConns) {
    await knex.schema.createTable('elasticsearch_connections', (t) => {
      t.uuid('id').primary();
      t.string('name', 128).notNullable();               // Human-readable label
      t.string('url', 1024).notNullable();                // e.g. https://es.example.com:9200
      t.string('auth_type', 32).notNullable().defaultTo('none');
      // auth_type: 'none' | 'basic' | 'api_key' | 'cloud_id'
      t.text('credentials_encrypted').nullable();         // JSON blob encrypted at rest
      // For basic: { username, password }
      // For api_key: { api_key }       (or { id, api_key })
      // For cloud_id: { cloud_id, api_key }
      t.boolean('tls_reject_unauthorized').notNullable().defaultTo(true);
      t.text('ca_cert').nullable();                       // Custom CA certificate (PEM)
      t.integer('request_timeout_ms').notNullable().defaultTo(30000);
      t.integer('max_retries').notNullable().defaultTo(3);
      t.integer('pool_max_connections').notNullable().defaultTo(10);
      t.boolean('is_default').notNullable().defaultTo(false);
      t.string('status', 32).notNullable().defaultTo('unknown');
      // status: 'unknown' | 'connected' | 'error'
      t.text('last_error').nullable();
      t.timestamp('last_health_check_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    console.log('[Migration 021] Created elasticsearch_connections table');
  }

  // Add FK from monitored_systems.es_connection_id → elasticsearch_connections.id
  // (safe even if column was just added)
  try {
    const fkExists = await knex.raw(`
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'monitored_systems'::regclass
        AND conname = 'monitored_systems_es_connection_id_fk'
    `);
    if (fkExists.rows.length === 0) {
      await knex.raw(`
        ALTER TABLE monitored_systems
        ADD CONSTRAINT monitored_systems_es_connection_id_fk
        FOREIGN KEY (es_connection_id)
        REFERENCES elasticsearch_connections(id)
        ON DELETE SET NULL
      `);
    }
  } catch (err: any) {
    console.warn(`[Migration 021] Could not add es_connection_id FK: ${err.message}`);
  }

  // ── 3. es_event_metadata table ───────────────────────────────
  const hasEsMeta = await knex.schema.hasTable('es_event_metadata');
  if (!hasEsMeta) {
    await knex.schema.createTable('es_event_metadata', (t) => {
      // Composite PK: (system_id, es_event_id)
      t.uuid('system_id').notNullable();
      t.string('es_event_id', 255).notNullable();          // Elasticsearch _id
      t.string('es_index', 512).nullable();                 // Source index name
      t.timestamp('acknowledged_at', { useTz: true }).nullable();
      t.uuid('template_id').nullable();                     // Link to message_templates
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['system_id', 'es_event_id']);
      t.index(['system_id', 'acknowledged_at'], 'idx_es_meta_ack');
    });
    console.log('[Migration 021] Created es_event_metadata table');
  }

  // ── 4. Widen event_scores.event_id from UUID to VARCHAR(255) ─
  //    The FK was dropped in migration 018 (partitioning).
  //    PostgreSQL can safely ALTER COLUMN type from uuid to varchar.
  try {
    const colResult = await knex.raw(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'event_scores' AND column_name = 'event_id' AND table_schema = 'public'
    `);
    const currentType = colResult.rows[0]?.data_type;
    if (currentType === 'uuid') {
      await knex.raw(`
        ALTER TABLE event_scores
        ALTER COLUMN event_id TYPE VARCHAR(255) USING event_id::text
      `);
      console.log('[Migration 021] Widened event_scores.event_id from UUID to VARCHAR(255)');
    } else {
      console.log(`[Migration 021] event_scores.event_id is already ${currentType}, skipping`);
    }
  } catch (err: any) {
    console.error(`[Migration 021] Failed to widen event_scores.event_id: ${err.message}`);
    throw err;
  }

  // ── 5. Add ES-related permissions to administrator role ──────
  const esPermissions = [
    'elasticsearch:view',
    'elasticsearch:manage',
  ];
  for (const perm of esPermissions) {
    try {
      await knex('role_permissions').insert({ role_name: 'administrator', permission: perm });
    } catch {
      // Already exists — ignore
    }
  }
  // Auditor gets read-only ES access
  try {
    await knex('role_permissions').insert({ role_name: 'auditor', permission: 'elasticsearch:view' });
  } catch {
    // Already exists — ignore
  }
  console.log('[Migration 021] Added elasticsearch permissions to roles');

  console.log('[Migration 021] Elasticsearch support migration complete');
}

export async function down(knex: Knex): Promise<void> {
  // ── Remove permissions ─────────────────────────────────────
  await knex('role_permissions')
    .whereIn('permission', ['elasticsearch:view', 'elasticsearch:manage'])
    .del();

  // ── Revert event_scores.event_id to UUID ───────────────────
  try {
    const colResult = await knex.raw(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'event_scores' AND column_name = 'event_id' AND table_schema = 'public'
    `);
    if (colResult.rows[0]?.data_type === 'character varying') {
      await knex.raw(`
        ALTER TABLE event_scores
        ALTER COLUMN event_id TYPE UUID USING event_id::uuid
      `);
    }
  } catch (err: any) {
    console.warn(`[Migration 021 down] Could not revert event_scores.event_id: ${err.message}`);
  }

  // ── Drop es_event_metadata ─────────────────────────────────
  await knex.schema.dropTableIfExists('es_event_metadata');

  // ── Remove FK from monitored_systems ───────────────────────
  try {
    await knex.raw(`ALTER TABLE monitored_systems DROP CONSTRAINT IF EXISTS monitored_systems_es_connection_id_fk`);
  } catch { /* ignore */ }

  // ── Drop elasticsearch_connections ─────────────────────────
  await knex.schema.dropTableIfExists('elasticsearch_connections');

  // ── Remove columns from monitored_systems ──────────────────
  const hasEventSource = await knex.schema.hasColumn('monitored_systems', 'event_source');
  if (hasEventSource) {
    await knex.schema.alterTable('monitored_systems', (t) => {
      t.dropColumn('es_connection_id');
      t.dropColumn('es_config');
      t.dropColumn('event_source');
    });
  }

  console.log('[Migration 021 down] Elasticsearch support reverted');
}
