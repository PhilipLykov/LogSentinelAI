import type { ConnectorAdapter } from './interface.js';
import { ElasticsearchConnector } from './elasticsearch.js';
import { LokiConnector } from './loki.js';
import { LogTideConnector } from './logtide.js';

/**
 * Registry of all available connector adapters.
 * Add new connectors here as they are implemented.
 */
const ADAPTERS: ConnectorAdapter[] = [
  new ElasticsearchConnector(),
  new LokiConnector(),
  new LogTideConnector(),
];

const ADAPTER_MAP = new Map<string, ConnectorAdapter>(
  ADAPTERS.map((a) => [a.type, a]),
);

export function getConnectorAdapter(type: string): ConnectorAdapter | undefined {
  return ADAPTER_MAP.get(type);
}

export function getAvailableConnectorTypes(): string[] {
  return Array.from(ADAPTER_MAP.keys());
}
