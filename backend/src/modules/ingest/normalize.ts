import { createHash } from 'node:crypto';
import type { IngestEntry, NormalizedEvent } from '../../types/index.js';

/**
 * Normalize a raw ingest entry into the internal event schema.
 * Supports common shapes: syslog-style, GELF, flat key-value.
 *
 * Returns null if the entry is invalid (missing message).
 */
export function normalizeEntry(entry: IngestEntry): NormalizedEvent | null {
  const message = entry.message ?? (entry as any).short_message ?? (entry as any).msg;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return null;
  }

  // Resolve timestamp: try multiple common field names
  let timestamp = entry.timestamp ?? (entry as any).time ?? (entry as any)['@timestamp'];
  if (!timestamp) {
    timestamp = new Date().toISOString();
  } else if (typeof timestamp === 'number') {
    // Unix epoch: handle seconds, milliseconds, microseconds, nanoseconds
    if (timestamp > 1e18) {
      // Nanoseconds
      timestamp = new Date(timestamp / 1_000_000).toISOString();
    } else if (timestamp > 1e15) {
      // Microseconds
      timestamp = new Date(timestamp / 1_000).toISOString();
    } else if (timestamp > 1e12) {
      // Milliseconds
      timestamp = new Date(timestamp).toISOString();
    } else {
      // Seconds
      timestamp = new Date(timestamp * 1000).toISOString();
    }
  } else if (typeof timestamp === 'string') {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {
      timestamp = new Date().toISOString();
    } else {
      timestamp = d.toISOString();
    }
  } else {
    timestamp = new Date().toISOString();
  }

  // Severity: normalize from syslog numeric or string
  let severity = entry.severity ?? (entry as any).level ?? (entry as any).syslog_severity;
  if (typeof severity === 'number') {
    severity = syslogSeverityToString(severity);
  } else if (typeof severity === 'string') {
    severity = severity.toLowerCase();
  } else {
    // Boolean, object, array, etc. — ignore
    severity = undefined;
  }

  // Build known fields; everything else goes into raw
  const known = new Set([
    'timestamp', 'time', '@timestamp',
    'message', 'short_message', 'msg',
    'severity', 'level', 'syslog_severity',
    'host', 'hostname', 'source',
    'source_ip', 'fromhost_ip', 'fromhost-ip', 'ip', 'client_ip', 'src_ip',
    'service', 'service_name', 'application',
    'facility', 'syslog_facility',
    'program', 'app_name', 'appname',
    'trace_id', 'traceId',
    'span_id', 'spanId',
    'external_id', 'connector_id',
    'raw', // Connector adapters pass pre-built raw — don't nest it
  ]);

  // Collect unknown fields into extras
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (!known.has(k) && v !== undefined) {
      extras[k] = v;
    }
  }

  // Merge: incoming raw (from connectors) + collected extras (from ingest API)
  const incomingRaw = entry.raw && typeof entry.raw === 'object' && !Array.isArray(entry.raw)
    ? (entry.raw as Record<string, unknown>)
    : undefined;
  const hasExtras = Object.keys(extras).length > 0;
  const mergedRaw = incomingRaw || hasExtras
    ? { ...(incomingRaw ?? {}), ...(hasExtras ? extras : {}) }
    : undefined;

  // Content-based severity enrichment: upgrade if message body
  // indicates a higher severity than the syslog header provided.
  const enrichedSeverity = enrichSeverityFromContent(message.trim(), severity);

  return {
    timestamp,
    message: message.trim(),
    severity: enrichedSeverity ?? undefined,
    host: stringField(entry, 'host', 'hostname', 'source'),
    source_ip: stringField(entry, 'source_ip', 'fromhost_ip', 'fromhost-ip', 'ip', 'client_ip', 'src_ip'),
    service: stringField(entry, 'service', 'service_name', 'application'),
    facility: stringField(entry, 'facility', 'syslog_facility'),
    program: stringField(entry, 'program', 'app_name', 'appname'),
    trace_id: stringField(entry, 'trace_id', 'traceId'),
    span_id: stringField(entry, 'span_id', 'spanId'),
    raw: mergedRaw,
    external_id: safeString(entry.external_id),
    connector_id: safeString(entry.connector_id),
  };
}

/**
 * Compute a normalized hash for dedup.
 * Uses null byte as separator to prevent delimiter-injection collisions.
 * Called AFTER redaction so the hash reflects the stored content.
 */
export function computeNormalizedHash(event: NormalizedEvent): string {
  const parts = [
    event.timestamp,
    event.message,
    event.host ?? '',
    event.source_ip ?? '',
    event.service ?? '',
    event.program ?? '',
    event.facility ?? '',
  ];
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

// ── helpers ──────────────────────────────────────────────────

function stringField(entry: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = entry[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Safely coerce to string or return undefined. */
function safeString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function syslogSeverityToString(n: number): string {
  const map: Record<number, string> = {
    0: 'emergency', 1: 'alert', 2: 'critical', 3: 'error',
    4: 'warning', 5: 'notice', 6: 'info', 7: 'debug',
  };
  return map[n] ?? 'info';
}

// ── Content-based severity enrichment ────────────────────────

/**
 * Severity priority (lower = more severe).  Matches RFC 5424.
 */
const SEVERITY_PRIORITY: Record<string, number> = {
  emergency: 0, emerg: 0,
  alert: 1,
  critical: 2, crit: 2,
  error: 3, err: 3,
  warning: 4, warn: 4,
  notice: 5,
  info: 6, informational: 6,
  debug: 7,
};

/**
 * Patterns that indicate a specific severity when found in the message body.
 * Ordered from most severe to least.  Each regex is tested case-insensitively.
 *
 * Categories of patterns:
 *  1. Structured log fields (key=value, key="value", JSON-like)
 *  2. Common log-line prefixes / tags
 *  3. Keyword heuristics (conservative — only strong signals)
 */
const CONTENT_SEVERITY_RULES: { severity: string; patterns: RegExp[] }[] = [
  // ── Emergency / Alert / Critical ────────────────────
  {
    severity: 'emergency',
    patterns: [
      /\blevel\s*[=:]\s*"?(?:emergency|emerg)\b/i,
      /\b(?:EMERGENCY|EMERG)\s*[:\]|]/,
    ],
  },
  {
    severity: 'alert',
    patterns: [
      /\blevel\s*[=:]\s*"?alert\b/i,
      /\bALERT\s*[:\]|]/,
    ],
  },
  {
    severity: 'critical',
    patterns: [
      /\blevel\s*[=:]\s*"?(?:critical|crit|fatal)\b/i,
      /\b(?:CRITICAL|CRIT|FATAL)\s*[:\]|]/,
      /\bpanic:/i,
      /\bkernel\s+panic\b/i,
      /\bout of memory\b/i,
    ],
  },
  // ── Error ───────────────────────────────────────────
  {
    severity: 'error',
    patterns: [
      // Structured: level=error, level="error", "level":"error"
      /\blevel\s*[=:]\s*"?(?:error|err)\b/i,
      // JSON-style: "severity":"error"
      /"(?:severity|level)"\s*:\s*"(?:error|err)"/i,
      // Log-line prefix:  ERROR: ..., [ERROR] ..., <error> ...
      /\bERROR\s*[:\]|>]/,
      // Common message-start pattern: "error: ..."
      // (only at word boundary + colon to avoid false positives)
      /\berror:/i,
      // Systemd / service failures
      /\bfailed with result\b/i,
      /\breturn(?:ed)? (?:non-zero|error|failure)\b/i,
      /\bsegmentation fault\b/i,
      /\bsegfault\b/i,
      /\bcore dumped\b/i,
      // Common exit-code failure patterns
      /\bexit(?:ed)?\s+(?:code|status)\s*[=:]?\s*[1-9]\d*/i,
    ],
  },
  // ── Warning ─────────────────────────────────────────
  {
    severity: 'warning',
    patterns: [
      /\blevel\s*[=:]\s*"?(?:warning|warn)\b/i,
      /"(?:severity|level)"\s*:\s*"(?:warning|warn)"/i,
      /\bWARN(?:ING)?\s*[:\]|>]/,
      /\bwarning:/i,
      // Deprecation warnings
      /\bdeprecated\b/i,
      // Restart / retry hints
      /\bwill not be restarted\b/i,
      /\bretry(?:ing)?\s+(?:in|after)\b/i,
      /\bShouldRestart failed\b/i,
    ],
  },
];

/**
 * Detect severity from message content and return the more severe
 * of (header severity, content severity).  Never downgrades.
 *
 * @param message  - The (trimmed) event message body.
 * @param headerSeverity - Severity from the syslog header (already lowercase), or undefined.
 * @returns The enriched severity string, or the original if no upgrade.
 */
function enrichSeverityFromContent(
  message: string,
  headerSeverity: string | undefined,
): string | undefined {
  const headerPriority = headerSeverity
    ? (SEVERITY_PRIORITY[headerSeverity] ?? 6)  // default to "info" if unknown
    : 7; // if no header severity, treat as lowest (debug)

  let bestContentPriority = Infinity;
  let bestContentSeverity: string | undefined;

  for (const rule of CONTENT_SEVERITY_RULES) {
    const rulePriority = SEVERITY_PRIORITY[rule.severity] ?? 6;
    // Skip if this rule can't beat what we already have
    if (rulePriority >= bestContentPriority) continue;

    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        bestContentPriority = rulePriority;
        bestContentSeverity = rule.severity;
        break; // no need to test more patterns for this severity
      }
    }
  }

  // Only upgrade — never downgrade
  if (bestContentSeverity && bestContentPriority < headerPriority) {
    return bestContentSeverity;
  }

  return headerSeverity;
}
