# Changelog

All notable changes to LogSentinel AI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.5-beta] - 2026-02-16

### Added
- **Per-Group Event Acknowledgement**: Acknowledge individual event groups directly from the criterion drill-down, rather than acknowledging all events in bulk
  - New "Ack" button on each event group row in the drill-down table
  - Backend endpoint `POST /api/v1/events/acknowledge-group` with automatic effective score recalculation
  - Corresponding "Un-ack" button when showing acknowledged events
  - Acknowledged events are deleted from `event_scores` and re-scored by the pipeline when un-acknowledged
  - Related open findings are automatically transitioned to "acknowledged" status when events are acked

- **Show Acknowledged Events Toggle**: Drill-down now hides acknowledged events by default, with a toggle to show them
  - Checkbox in the drill-down header to reveal acknowledged groups
  - Acknowledged groups are visually distinguished with a muted style
  - Backend `show_acknowledged` query parameter on the grouped event scores endpoint

- **Finding Proof Events ("Show Events")**: View the source events that contributed to an AI finding
  - "Show Events" / "Hide Events" toggle button on each finding card
  - Fetches events by `key_event_ids` stored on findings when they are created
  - Events scoped to the specific finding (no cross-finding leakage)
  - New backend endpoint `POST /api/v1/events/by-ids` with input validation

- **Active Issues Breakdown**: The AI Findings banner now shows a detailed breakdown
  - Displays "X active issues (Y open, Z ack'd)" instead of just a count
  - Separate badge colors for open vs acknowledged findings

- **Findings Key Event IDs**: AI findings now store references to the source events that triggered them
  - `key_event_ids` column on the `findings` table, populated at creation time
  - Text-overlap matching between finding description and event messages

### Changed
- **Event Acknowledgement Deletes Scores**: Acknowledging events now deletes their `event_scores` rows instead of setting scores to zero, enabling proper re-scoring when un-acknowledged
- **Effective Score Excludes Acked Events**: The `max_event_score` in effective score calculation now filters out acknowledged events via a `whereNotExists` subquery
- **Re-Evaluate Excludes Acked Events**: The "Re-evaluate" button always passes `excludeAcknowledged: true` to meta-analysis, ensuring fresh summaries don't reference acknowledged events
- **Grouped Endpoint Filters Acked**: The grouped event scores API now excludes acknowledged events by default (`whereNull('events.acknowledged_at')`)
- **Docker Healthcheck Start Period**: Added `--start-period=60s` to both backend and dashboard Docker healthchecks, preventing false "unhealthy" status during container startup
- **Increased Body Limit**: Backend HTTP body limit increased from 10MB to 50MB to accommodate large Fluent Bit batches
- **Fluent Bit Tuning**: Added `Mem_Buf_Limit 10MB` to Docker tail input and `Workers 2` to HTTP output for better throughput

### Fixed
- **Catch-All Source Matching**: Universal wildcard patterns (`.*`, `^.*$`, `.+`, `^.+$`) now correctly match events where the target field is `undefined` or `null`, fixing catch-all log source routing
- **Guardrail 2 False Positive**: Fixed a bug where the self-referential check (Guardrail 2) would incorrectly reject LLM resolutions when all referenced events had empty messages, because `allSelfReferential` stayed `true` without any actual comparison. Added `anyRefChecked` guard
- **Guardrail 3 Bypass via Hallucinated Refs**: Fixed a bug where hallucinated event indices from the LLM (not in `eventIndexToSeverity` map) were treated as "non-error evidence", potentially allowing resolutions that only had error-severity proof events. Unknown refs are now skipped instead of counted
- **LLM Empty Content Crash**: Changed `content ?? '{}'` to `content || '{}'` in the LLM adapter so empty string responses (from some providers) are correctly replaced with a default JSON object instead of causing `JSON.parse("")` to throw
- **Error-Path Model Reporting**: Fixed the `scoreEvents` catch block to report the effective model (with per-task override) in usage tracking instead of always reporting the base model
- **Finding Proof Events Leak**: Fixed a bug where clicking "Show Events" on one finding would display events under all findings that shared overlapping `key_event_ids`. Introduced `findingProofShown` state to scope events to the specific finding
- **Finding Toggle-Off Dead Code**: The "Show Events" button was disabled during loading and the loading state was cleared in `finally`, making the toggle-off branch unreachable. Redesigned with separate `findingProofShown` state so users can now click "Hide Events" to dismiss
- **Score Bar Overflow**: Score percentage is now clamped to 0-100% (`Math.max(0, Math.min(1, value))`) to prevent visual overflow from corrupt or out-of-range data
- **`useCallback` Dependency Arrays**: Added missing `showAcknowledged` to `handleMarkOkConfirm` and `handleReEvaluate` dependency arrays, preventing stale closure bugs when the toggle changes
- **Optimistic Ack Update**: When showing acknowledged events, the per-group Ack button now optimistically sets `acknowledged: true` on the group instead of leaving it with stale state
- **TypeScript Type Safety**: Removed unnecessary `(grp as any).acknowledged` casts (type already includes the field); fixed `EventDetail` interface to use nullable types for `host`, `source_ip`, `severity`, `program`; made `AckGroupResponse` fields optional for zero-match responses
- **Event ID Validation**: Added per-ID type and format validation (`/^[0-9a-zA-Z_-]{1,128}$/`) to the `POST /api/v1/events/by-ids` endpoint
- **Comment Accuracy**: Fixed misleading comment in `transitionFindingsOnAck` that said "3 words" but actually used 50% overlap threshold

## [0.8.4-beta] - 2026-02-15

### Added
- **LLM Cost Optimization Suite**: 16 independent optimization techniques with full UI configuration
  - Template deduplication, score caching (6h TTL), normal behavior filtering, severity pre-filter
  - Zero-score window skip (O1), zero-score event filter (O2), high-score prioritization
  - Message truncation, batch sizing, meta-analysis event cap
  - Per-task model selection (scoring, meta, RAG), configurable pipeline interval
  - Configurable scoring limit per run, privacy filtering, context window size
- **Pipeline Settings UI**: Configure pipeline interval, window size, scoring limit, and meta weight
- **Per-Task Model Overrides UI**: Set different LLM models for scoring, meta-analysis, and RAG
- **LLM Usage Tracking**: Per-request metrics, per-system breakdown, daily usage charts
- **Cost Documentation**: Comprehensive README section on all 16 cost optimization techniques with flow diagram

### Changed
- Score cache TTL default changed from 60 to 360 minutes
- Meta-analysis config defaults aligned with runtime values

### Fixed
- Dynamic index discovery in maintenance REINDEX (prevents errors for non-existent indexes)
- `modelOverride` added to `LlmAdapter` interface signatures
- Unused `taskModelResp` variable removed
- Correct model name in warning logs and usage tracking

## [0.8.3-beta] - 2026-02-13

### Added
- **Mark as Normal Behavior**: Users can mark event patterns as "normal behavior" from the criterion drill-down
  - Generates universal templates that exclude variable data (ports, IPs, device names)
  - Future matching events are automatically scored at 0 without LLM calls
  - Management interface shows all templates with audit details (user, date, pattern)
  - Retroactive score zeroing for matching events within the configurable display window
- **Re-Evaluate Button**: Manual trigger for fresh meta-analysis from the drill-down panel
  - Stale effective scores are zeroed within the display window after re-evaluation
- **Configurable Score Display Window**: Dashboard time window configurable from 1-90 days (default 7)
- **Docker Container Log Enrichment**: Lua-based Fluent Bit filter for Docker container logs
  - Severity extraction from message content (bracketed, key=value, JSON)
  - Container name resolution from Docker config
  - Message cleanup (embedded timestamps, ANSI codes)

### Changed
- Score display window moved from hardcoded 2h to configurable 7d default
- Dashboard overview uses MAX(effective_scores) across the configured window

### Fixed
- AI auto-resolve guardrails: proof-based resolution only (no time-based auto-resolve)
  - Guardrail 1: Contradictory phrase detection in resolution evidence
  - Guardrail 2: Self-referential check prevents closing with own event
  - Guardrail 3: Error-severity events cannot serve as resolution proof
- High-score prioritization uses correct index maps after O2 filtering
- Meta-analysis config defaults consistency between UI and runtime

## [0.8.2-beta] - 2026-02-10

### Added
- **AI Behavior Full Revision**: Comprehensive overhaul of all AI mechanisms
  - Redesigned scoring prompts for professional IT engineers
  - Proof-based finding resolution (no time-based auto-close)
  - Finding deduplication with TF-IDF cosine and Jaccard similarity
  - Resolution evidence stored with event IDs for traceability
  - Flapping prevention (resolved findings never reopen; recurring issues create new findings)
- **Elasticsearch Integration**: Hybrid event storage with read-only ES queries
- **Event Explorer**: Full-text search with filtering, sorting, and pagination
- **Cross-System Event Tracing**: Correlate events across systems by trace ID or message

### Fixed
- Various scoring prompt improvements for noise reduction
- Finding lifecycle management edge cases

## [0.8.1-beta] - 2026-02-05

### Added
- Initial public beta release
- Multi-system monitoring with PostgreSQL event storage
- 6-criteria AI event scoring with configurable prompts
- Meta-analysis pipeline with sliding windows
- Real-time dashboard with SSE score streaming
- Role-based access control (3 roles, 20 permissions)
- Notification system (Webhook, Pushover, NTfy, Gotify, Telegram)
- Database backup and maintenance automation
- Privacy controls with PII masking
- Docker deployment with optional Fluent Bit collector
