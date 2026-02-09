import knex, { type Knex } from 'knex';
import knexConfig from './knexConfig.js';
import { localTimestamp } from '../config/index.js';

let _db: Knex | undefined;

export function getDb(): Knex {
  if (!_db) {
    _db = knex(knexConfig);
  }
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.destroy();
    _db = undefined;
  }
}

/** Run all pending migrations and seeds. On failure, close DB and re-throw. */
export async function initDb(): Promise<void> {
  const db = getDb();
  try {
    console.log(`[${localTimestamp()}] Running database migrations…`);
    await db.migrate.latest();
    console.log(`[${localTimestamp()}] Running database seeds…`);
    await db.seed.run();
    console.log(`[${localTimestamp()}] Database ready.`);
  } catch (err) {
    console.error(`[${localTimestamp()}] Database initialization failed:`, err);
    await closeDb();
    throw err;
  }
}
