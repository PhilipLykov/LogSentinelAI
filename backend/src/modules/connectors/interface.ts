import type { NormalizedEvent } from '../../types/index.js';

/**
 * Connector interface: all pull/stream connectors implement this.
 * Push connectors (webhook, syslog) are handled via ingest API or dedicated server.
 */
export interface ConnectorAdapter {
  /** Unique type key matching connectors.type column */
  readonly type: string;

  /**
   * Fetch logs since the last cursor value.
   * Returns normalized events and a new cursor value.
   */
  fetchLogs(
    config: Record<string, unknown>,
    cursor: string | null,
  ): Promise<{ events: NormalizedEvent[]; newCursor: string | null }>;
}
