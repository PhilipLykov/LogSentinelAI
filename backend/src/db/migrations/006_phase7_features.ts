import type { Knex } from 'knex';

/**
 * Phase 7: app_config, export_jobs, detection_profiles, scheduled_reports.
 */
export async function up(knex: Knex): Promise<void> {
  // ── app_config ─────────────────────────────────────────────
  await knex.schema.createTable('app_config', (t) => {
    t.string('key', 128).primary();
    t.jsonb('value').notNullable();
  });

  // Seed default config
  await knex('app_config').insert([
    {
      key: 'severity_bands',
      value: JSON.stringify({ critical: 0.75, high: 0.5, medium: 0.25, low: 0 }),
    },
    {
      key: 'w_meta',
      value: JSON.stringify(0.7),
    },
    {
      key: 'redaction',
      value: JSON.stringify({ enabled: false, patterns: [], redact_raw: true }),
    },
  ]);

  // ── export_jobs ────────────────────────────────────────────
  await knex.schema.createTable('export_jobs', (t) => {
    t.uuid('id').primary();
    t.string('type', 32).notNullable();    // compliance_pdf | csv | json
    t.jsonb('params').notNullable();        // { system_ids, from, to, template }
    t.string('status', 32).notNullable().defaultTo('pending'); // pending | running | done | error
    t.text('file_path').nullable();
    t.text('error_message').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('completed_at', { useTz: true }).nullable();
  });

  // ── detection_profiles ─────────────────────────────────────
  await knex.schema.createTable('detection_profiles', (t) => {
    t.uuid('id').primary();
    t.string('name', 255).notNullable();
    t.uuid('system_id').nullable().references('id').inTable('monitored_systems').onDelete('SET NULL');
    t.jsonb('criterion_weights').nullable();     // { it_security: 1.2, anomaly: 0.8, ... }
    t.jsonb('prompt_overrides').nullable();       // custom prompt fragments
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── scheduled_reports ──────────────────────────────────────
  await knex.schema.createTable('scheduled_reports', (t) => {
    t.uuid('id').primary();
    t.string('name', 255).notNullable();
    t.uuid('channel_id').nullable().references('id').inTable('notification_channels').onDelete('SET NULL');
    t.string('schedule', 64).notNullable();      // cron expression
    t.string('report_type', 64).notNullable().defaultTo('summary');
    t.jsonb('filters').nullable();                // { system_ids, criteria }
    t.timestamp('last_run_at', { useTz: true }).nullable();
    t.timestamp('next_run_at', { useTz: true }).nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('scheduled_reports');
  await knex.schema.dropTableIfExists('detection_profiles');
  await knex.schema.dropTableIfExists('export_jobs');
  await knex.schema.dropTableIfExists('app_config');
}
