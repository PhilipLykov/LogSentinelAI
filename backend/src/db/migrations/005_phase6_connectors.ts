import type { Knex } from 'knex';

/**
 * Phase 6: Connectors and connector_cursors tables.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('connectors', (t) => {
    t.uuid('id').primary();
    t.string('type', 64).notNullable();   // webhook | pull_elasticsearch | pull_loki | pull_logtide | pull_victorialogs | syslog | kafka
    t.string('name', 255).notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.jsonb('config').notNullable();       // URL, index, query template, etc. No secrets.
    t.integer('poll_interval_seconds').notNullable().defaultTo(300);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('connector_cursors', (t) => {
    t.uuid('connector_id').primary().references('id').inTable('connectors').onDelete('CASCADE');
    t.string('cursor_key', 128).notNullable().defaultTo('last_timestamp');
    t.text('cursor_value').nullable();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Add FK from events.connector_id → connectors.id
  // (column already exists from Phase 1 as nullable UUID)
  await knex.schema.alterTable('events', (t) => {
    t.foreign('connector_id').references('id').inTable('connectors').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove FK before dropping tables
  await knex.schema.alterTable('events', (t) => {
    t.dropForeign(['connector_id']);
  });
  await knex.schema.dropTableIfExists('connector_cursors');
  await knex.schema.dropTableIfExists('connectors');
}
