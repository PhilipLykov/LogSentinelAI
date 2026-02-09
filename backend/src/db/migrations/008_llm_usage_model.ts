import type { Knex } from 'knex';

/**
 * Add model column to llm_usage so each record tracks which LLM model was
 * used at the time of the API call. Without this, cost estimates break when
 * the user switches models (e.g. gpt-4o-mini → gpt-4o).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('llm_usage', (t) => {
    // Nullable: old records before this migration won't have a model stored.
    t.string('model', 64).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('llm_usage', (t) => {
    t.dropColumn('model');
  });
}
