import type { ConnectorAdapter } from './interface.js';
import type { NormalizedEvent } from '../../types/index.js';
import { resolveEnvRef } from './envRef.js';
import { validateUrl } from './urlValidation.js';

/**
 * Pull connector for LogTide.
 *
 * Polls the LogTide Logs API: GET /api/v1/logs?from=&to=&limit=
 *
 * Config: { url, api_key_ref }
 */
export class LogTideConnector implements ConnectorAdapter {
  readonly type = 'pull_logtide';

  async fetchLogs(
    config: Record<string, unknown>,
    cursor: string | null,
  ): Promise<{ events: NormalizedEvent[]; newCursor: string | null }> {
    const url = (config.url ?? '') as string;
    const apiKeyRef = config.api_key_ref as string;

    if (!url) throw new Error('LogTide URL not configured');
    validateUrl(url);

    const from = cursor ?? new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const params = new URLSearchParams({ from, to, limit: '1000' });
    const headers: Record<string, string> = {};
    if (apiKeyRef) {
      const key = resolveEnvRef(apiKeyRef);
      if (key) headers['X-API-Key'] = key;
    }

    const res = await fetch(`${url}/api/v1/logs?${params}`, {
      headers,
      redirect: 'error', // SSRF: prevent redirects to internal IPs
    });

    if (!res.ok) throw new Error(`LogTide ${res.status}: ${await res.text()}`);

    const data = await res.json() as any;
    const logs = Array.isArray(data) ? data : (data.logs ?? data.data ?? []);

    const events: NormalizedEvent[] = logs.map((log: any) => ({
      timestamp: log.timestamp ?? log.time ?? new Date().toISOString(),
      message: log.message ?? log.msg ?? '',
      severity: log.severity ?? log.level,
      host: log.host ?? log.hostname,
      service: log.service,
      facility: log.facility,
      program: log.program ?? log.app_name,
      raw: log,
      external_id: log.id,
    }));

    // Use the last event's timestamp as cursor; fetchLogs uses gt (not gte)
    // so the next poll starts AFTER this timestamp
    const newCursor = events.length > 0
      ? events[events.length - 1].timestamp
      : to;

    return { events, newCursor };
  }
}
