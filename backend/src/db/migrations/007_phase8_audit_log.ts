import type { Knex } from 'knex';

/**
 * Phase 8: audit_log for auth and config change tracking.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_log', (t) => {
    t.uuid('id').primary();
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('actor', 255).nullable();             // API key id or user id
    t.string('action', 64).notNullable();          // create | update | delete | login_fail
    t.string('resource_type', 64).notNullable();   // system | source | channel | rule | silence | connector | config
    t.string('resource_id', 255).nullable();
    t.jsonb('details').nullable();                  // No secrets in details (A09)
    t.string('ip', 64).nullable();

    t.index(['at']);
    t.index(['action']);
    t.index(['resource_type', 'resource_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_log');
}
