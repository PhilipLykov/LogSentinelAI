import type { Knex } from 'knex';

/**
 * Resolved AI configuration, reading from app_config (DB) first,
 * then falling back to environment variables.
 *
 * Values set via the UI (stored in app_config) take precedence over
 * env vars. This allows runtime configuration without restarting.
 */
export interface AiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

// In-memory cache — avoids hitting DB on every LLM call.
let _cache: AiConfig | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Resolve the current AI configuration.
 * Priority: app_config table → environment variables → defaults.
 */
export async function resolveAiConfig(db: Knex): Promise<AiConfig> {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  const rows = await db('app_config')
    .whereIn('key', ['openai_api_key', 'openai_model', 'openai_base_url'])
    .select('key', 'value');

  const dbValues: Record<string, string> = {};
  for (const row of rows) {
    let val = row.value;
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch { /* use as-is */ }
    }
    if (typeof val === 'string' && val.trim() !== '') {
      dbValues[row.key] = val;
    }
  }

  _cache = {
    apiKey: dbValues['openai_api_key'] ?? process.env.OPENAI_API_KEY ?? '',
    model: dbValues['openai_model'] ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    baseUrl: dbValues['openai_base_url'] ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  };
  _cacheTs = now;

  return _cache;
}

/** Flush the cache so next resolveAiConfig reads from DB. */
export function invalidateAiConfigCache(): void {
  _cache = null;
  _cacheTs = 0;
  _promptCache = null;
  _promptCacheTs = 0;
}

// ── Custom system prompt resolution ─────────────────────────

export interface CustomPrompts {
  /** Custom scoring system prompt. undefined = use built-in default. */
  scoringSystemPrompt?: string;
  /** Custom meta-analysis system prompt. undefined = use built-in default. */
  metaSystemPrompt?: string;
  /** Custom RAG (Ask Question) system prompt. undefined = use built-in default. */
  ragSystemPrompt?: string;
}

let _promptCache: CustomPrompts | null = null;
let _promptCacheTs = 0;

/**
 * Resolve custom system prompts from app_config.
 * Returns undefined for each prompt that is not set (= use default).
 */
export async function resolveCustomPrompts(db: Knex): Promise<CustomPrompts> {
  const now = Date.now();
  if (_promptCache && now - _promptCacheTs < CACHE_TTL_MS) return _promptCache;

  const rows = await db('app_config')
    .whereIn('key', ['scoring_system_prompt', 'meta_system_prompt', 'rag_system_prompt'])
    .select('key', 'value');

  const result: CustomPrompts = {};
  for (const row of rows) {
    let val = row.value;
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch { /* use as-is */ }
    }
    if (typeof val === 'string' && val.trim() !== '') {
      if (row.key === 'scoring_system_prompt') result.scoringSystemPrompt = val;
      if (row.key === 'meta_system_prompt') result.metaSystemPrompt = val;
      if (row.key === 'rag_system_prompt') result.ragSystemPrompt = val;
    }
  }

  _promptCache = result;
  _promptCacheTs = now;
  return result;
}
