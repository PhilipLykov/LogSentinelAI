import type { ConnectorAdapter } from './interface.js';
import type { NormalizedEvent } from '../../types/index.js';
import { resolveEnvRef } from './envRef.js';
import { validateUrl } from './urlValidation.js';

/**
 * Pull connector for Elasticsearch / OpenSearch.
 *
 * Polls the _search API with a time range filter on the log index.
 * Maps _source hits to normalized events.
 *
 * Config: { url, index, auth_header_ref?, query_extra? }
 */
export class ElasticsearchConnector implements ConnectorAdapter {
  readonly type = 'pull_elasticsearch';

  async fetchLogs(
    config: Record<string, unknown>,
    cursor: string | null,
  ): Promise<{ events: NormalizedEvent[]; newCursor: string | null }> {
    const url = (config.url ?? '') as string;
    const index = (config.index ?? 'logs-*') as string;
    const authRef = config.auth_header_ref as string | undefined;

    if (!url) throw new Error('Elasticsearch URL not configured');
    validateUrl(url);

    const since = cursor ?? new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const body = {
      query: {
        bool: {
          filter: [
            // Use gt (not gte) to avoid re-fetching the cursor boundary event
            { range: { '@timestamp': { gt: since, lte: now } } },
          ],
        },
      },
      size: 1000,
      sort: [{ '@timestamp': 'asc' }],
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authRef) {
      const val = resolveEnvRef(authRef);
      if (val) headers.Authorization = val;
    }

    const res = await fetch(`${url}/${encodeURIComponent(index)}/_search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error', // SSRF: prevent redirects to internal IPs
    });

    if (!res.ok) throw new Error(`Elasticsearch ${res.status}: ${await res.text()}`);

    const data = await res.json() as any;
    const hits = data.hits?.hits ?? [];

    const events: NormalizedEvent[] = hits.map((hit: any) => {
      const src = hit._source ?? {};
      return {
        timestamp: src['@timestamp'] ?? src.timestamp ?? new Date().toISOString(),
        message: src.message ?? src.log ?? JSON.stringify(src),
        severity: src.level ?? src.severity ?? src.log_level,
        host: src.host?.name ?? src.hostname ?? (typeof src.host === 'string' ? src.host : undefined),
        service: src.service?.name ?? (typeof src.service === 'string' ? src.service : undefined),
        facility: src.facility,
        program: src.process?.name ?? src.program,
        raw: src,
        external_id: hit._id,
      } satisfies NormalizedEvent;
    });

    const newCursor = events.length > 0
      ? events[events.length - 1].timestamp
      : now;

    return { events, newCursor };
  }
}
