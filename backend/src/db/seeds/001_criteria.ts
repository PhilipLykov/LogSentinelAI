import type { Knex } from 'knex';
import { CRITERIA } from '../../types/index.js';

/** Seed the 6 fixed analysis criteria. Idempotent (insert-or-ignore). */
export async function seed(knex: Knex): Promise<void> {
  for (const c of CRITERIA) {
    const exists = await knex('criteria').where({ id: c.id }).first();
    if (!exists) {
      await knex('criteria').insert({ id: c.id, slug: c.slug, name: c.name });
    }
  }
}
