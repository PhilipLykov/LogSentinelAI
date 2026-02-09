const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function getApiKey(): string {
  return localStorage.getItem('apiKey') ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem('apiKey', key);
}

export function getStoredApiKey(): string {
  return getApiKey();
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': getApiKey(),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('Network error — check your connection and try again.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `API ${res.status}`);
  }

  // Handle 204 No Content (e.g., DELETE responses)
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────

export interface SystemScoreInfo {
  effective: number;
  meta: number;
  max_event: number;
}

export interface DashboardSystem {
  id: string;
  name: string;
  description: string;
  source_count: number;
  event_count_24h: number;
  latest_window: { id: string; from: string; to: string } | null;
  scores: Record<string, SystemScoreInfo>;
  updated_at: string;
}

export interface MonitoredSystem {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface LogSource {
  id: string;
  system_id: string;
  label: string;
  selector: Record<string, string>;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface LogEvent {
  id: string;
  system_id: string;
  log_source_id: string;
  timestamp: string;
  message: string;
  severity?: string;
  host?: string;
  service?: string;
  program?: string;
  facility?: string;
}

export interface MetaResult {
  id: string;
  window_id: string;
  meta_scores: Record<string, number>;
  summary: string;
  findings: string[];
  recommended_action?: string;
}

// ── Dashboard API calls ──────────────────────────────────────

export async function fetchDashboardSystems(): Promise<DashboardSystem[]> {
  return apiFetch('/api/v1/dashboard/systems');
}

export async function fetchSystemEvents(
  systemId: string,
  opts?: { from?: string; to?: string; limit?: number },
): Promise<LogEvent[]> {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  if (opts?.limit) params.set('limit', String(opts.limit));
  return apiFetch(`/api/v1/systems/${systemId}/events?${params}`);
}

export async function fetchSystemMeta(
  systemId: string,
  windowId?: string,
): Promise<MetaResult> {
  const params = windowId ? `?window_id=${windowId}` : '';
  return apiFetch(`/api/v1/systems/${systemId}/meta${params}`);
}

// ── Systems CRUD ─────────────────────────────────────────────

export async function fetchSystems(): Promise<MonitoredSystem[]> {
  return apiFetch('/api/v1/systems');
}

export async function createSystem(data: { name: string; description?: string }): Promise<MonitoredSystem> {
  return apiFetch('/api/v1/systems', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSystem(
  id: string,
  data: { name?: string; description?: string },
): Promise<MonitoredSystem> {
  return apiFetch(`/api/v1/systems/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSystem(id: string): Promise<void> {
  return apiFetch(`/api/v1/systems/${id}`, { method: 'DELETE' });
}

// ── Log Sources CRUD ─────────────────────────────────────────

export async function fetchSources(systemId?: string): Promise<LogSource[]> {
  const params = systemId ? `?system_id=${systemId}` : '';
  return apiFetch(`/api/v1/sources${params}`);
}

export async function createSource(data: {
  system_id: string;
  label: string;
  selector: Record<string, string>;
  priority?: number;
}): Promise<LogSource> {
  return apiFetch('/api/v1/sources', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSource(
  id: string,
  data: { label?: string; selector?: Record<string, string>; priority?: number },
): Promise<LogSource> {
  return apiFetch(`/api/v1/sources/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSource(id: string): Promise<void> {
  return apiFetch(`/api/v1/sources/${id}`, { method: 'DELETE' });
}

/**
 * Validate an API key against the backend.
 * Returns true if valid, false if 401/403.
 * Throws on network errors so callers can distinguish "bad key" from "server unreachable".
 */
export async function validateApiKey(key: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/v1/dashboard/systems`, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
    },
  });
  return res.ok;
}

/**
 * Create an SSE connection for real-time score updates.
 * Note: EventSource does not support custom headers, so the API key is passed
 * as a query parameter. In production, consider using a session-based approach
 * or a custom EventSource polyfill with header support.
 */
export function createScoreStream(onMessage: (data: unknown) => void): EventSource {
  const url = `${BASE_URL}/api/v1/scores/stream`;
  const es = new EventSource(`${url}?key=${encodeURIComponent(getApiKey())}`);
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch { /* ignore parse errors */ }
  };
  return es;
}
