import type { Knex } from 'knex';

/**
 * Persistent findings table.
 *
 * Instead of storing findings as a disposable JSONB array inside meta_results,
 * each finding becomes a first-class entity with its own lifecycle:
 *   open → acknowledged | resolved (by AI or manually)
 *
 * This enables:
 *  - Acknowledge buttons per finding (operator workflow)
 *  - Findings that persist across meta-analysis runs
 *  - Historical context: the LLM receives prior open findings as input,
 *    so it can mark them resolved or build on them (sliding context window)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('findings', (t) => {
    t.uuid('id').primary();
    t.uuid('system_id').notNullable().references('id').inTable('monitored_systems').onDelete('CASCADE');
    t.uuid('meta_result_id').notNullable().references('id').inTable('meta_results').onDelete('CASCADE');

    t.text('text').notNullable();
    t.string('severity', 16).notNullable().defaultTo('medium');  // critical | high | medium | low | info
    t.string('criterion_slug', 40).nullable();                    // e.g. 'it_security'
    t.string('status', 16).notNullable().defaultTo('open');       // open | acknowledged | resolved

    // Acknowledgment tracking
    t.timestamp('acknowledged_at', { useTz: true }).nullable();
    t.string('acknowledged_by', 128).nullable();                  // who acknowledged (future: user ID)

    // Resolution tracking (when AI says finding is no longer relevant)
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.uuid('resolved_by_meta_id').nullable();                     // which meta run resolved it

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['system_id', 'status']);
    t.index(['meta_result_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('findings');
}
