import { config } from '../config/index.js';
import type { Knex } from 'knex';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Knex configuration — single source of truth for runtime.
 * Migration/seed paths are resolved relative to this file's location,
 * so they work both in dev (src/) and production (dist/).
 *
 * In production (compiled JS), we must load .js files only.
 * In development (tsx), we load .ts files.
 */
const isProduction = process.env.NODE_ENV === 'production';
const ext = isProduction ? 'js' : 'ts';

const knexConfig: Knex.Config = {
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: ext,
    loadExtensions: [`.${ext}`],
  },
  seeds: {
    directory: path.join(__dirname, 'seeds'),
    extension: ext,
    loadExtensions: [`.${ext}`],
  },
};

export default knexConfig;
