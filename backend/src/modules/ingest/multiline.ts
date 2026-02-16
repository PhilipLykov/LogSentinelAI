/**
 * Multiline syslog reassembly module.
 *
 * PostgreSQL (and some other programs) emit multi-line log messages via syslog.
 * Because syslog is inherently single-line, each continuation is delivered as
 * a separate syslog message.  PostgreSQL marks these with a continuation header
 * in the message body:
 *
 *   [session_line-1] first part of the message
 *   [session_line-2] #011continuation...
 *   [session_line-3] #011continuation...
 *
 * Where `session_line` is the log line number within the PostgreSQL session,
 * the second number is the continuation index (1 = head, 2+ = continuation),
 * and `#011` is the octal representation of a tab character.
 *
 * This module scans an ingest batch of raw entries BEFORE normalisation and
 * merges adjacent continuation lines into a single event.  It operates
 * entirely within a single batch (no cross-batch state) which is safe because
 * log shippers typically batch events in order and continuations are adjacent.
 *
 * The module is designed to be extensible: additional multiline patterns (e.g.
 * Java stack traces, Python tracebacks) can be added to `MULTILINE_PATTERNS`.
 */

// ── Types ────────────────────────────────────────────────────────

/** Minimal shape of an ingest entry before normalisation. */
interface RawEntry {
  message?: string;
  host?: string;
  program?: string;
  [key: string]: unknown;
}

/** Parsed continuation metadata from a PostgreSQL syslog line. */
interface PgContinuationInfo {
  sessionLine: number;
  continuation: number;
  body: string;
}

// ── PostgreSQL continuation pattern ──────────────────────────────

/**
 * Matches the PostgreSQL syslog continuation header at the start of a message.
 *
 * Format: `[<session_line>-<continuation>] <rest>`
 *
 * Examples:
 *   `[5-1] 2026-02-16 13:45:58.351 EET [116965] syslog_ai@...`
 *   `[5-2] #011    WITH window_max AS (`
 */
const PG_CONTINUATION_RE = /^\[(\d+)-(\d+)\]\s*/;

/**
 * Attempt to parse the PostgreSQL continuation header from a message.
 * Returns null if the message does not match the pattern.
 */
function parsePgContinuation(message: string): PgContinuationInfo | null {
  const m = PG_CONTINUATION_RE.exec(message);
  if (!m) return null;
  return {
    sessionLine: parseInt(m[1], 10),
    continuation: parseInt(m[2], 10),
    body: message.slice(m[0].length),
  };
}

/**
 * Convert syslog octal escape `#011` (horizontal tab) to a real tab character.
 * Also handles `#012` (newline) which PostgreSQL occasionally emits.
 */
function decodeSyslogOctalEscapes(text: string): string {
  return text
    .replace(/#011/g, '\t')
    .replace(/#012/g, '\n');
}

// ── Core reassembly logic ────────────────────────────────────────

/**
 * Reassemble multiline syslog entries in a batch.
 *
 * Scans the entries array for PostgreSQL-style continuation lines and merges
 * them into a single entry.  The merged entry inherits the timestamp, severity,
 * host, and program of the *first* line in the group (the `[N-1]` head).
 *
 * Entries that do not match any multiline pattern pass through unchanged.
 *
 * @param entries - Mutable array of raw ingest entries (pre-normalisation).
 * @returns A new array with merged entries (length <= entries.length).
 */
export function reassembleMultilineEntries(entries: unknown[]): unknown[] {
  if (!entries || entries.length <= 1) return entries;

  const result: unknown[] = [];

  let i = 0;
  while (i < entries.length) {
    const entry = entries[i] as RawEntry | null | undefined;

    // Skip non-object / null entries — pass through as-is
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.message !== 'string') {
      result.push(entries[i]);
      i++;
      continue;
    }

    const parsed = parsePgContinuation(entry.message);

    // Not a PostgreSQL continuation line — pass through
    if (!parsed) {
      result.push(entries[i]);
      i++;
      continue;
    }

    // If this is a continuation (not the head), it's an orphan — pass through
    // with the continuation marker stripped for readability.
    if (parsed.continuation !== 1) {
      result.push({
        ...entry,
        message: decodeSyslogOctalEscapes(parsed.body),
      });
      i++;
      continue;
    }

    // ── Head line found ([N-1]).  Scan ahead for continuations. ──
    const headHost = entry.host ?? '';
    const headProgram = entry.program ?? '';
    const sessionLine = parsed.sessionLine;
    const parts: string[] = [decodeSyslogOctalEscapes(parsed.body)];

    let j = i + 1;
    while (j < entries.length) {
      const next = entries[j] as RawEntry | null | undefined;
      if (!next || typeof next !== 'object' || Array.isArray(next) || typeof next.message !== 'string') {
        break;
      }

      // Must be from the same host + program
      if ((next.host ?? '') !== headHost || (next.program ?? '') !== headProgram) {
        break;
      }

      const nextParsed = parsePgContinuation(next.message);
      if (!nextParsed) break;

      // Must be the same session line and continuation index must be sequential
      if (nextParsed.sessionLine !== sessionLine || nextParsed.continuation !== parts.length + 1) {
        break;
      }

      parts.push(decodeSyslogOctalEscapes(nextParsed.body));
      j++;
    }

    // If only the head was found (no continuations), emit as-is with marker stripped
    if (parts.length === 1) {
      result.push({
        ...entry,
        message: parts[0],
      });
      i++;
      continue;
    }

    // Merge all parts into a single message with newline separators
    const mergedMessage = parts.join('\n');

    // Build merged entry: use head's metadata, replace message
    result.push({
      ...entry,
      message: mergedMessage,
    });

    // Advance past all consumed continuation entries
    i = j;
  }

  return result;
}
