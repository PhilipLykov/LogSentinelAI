# LogSentinel AI v0.8.0-beta — Elasticsearch Integration

**Hybrid event storage: read events directly from existing Elasticsearch clusters without duplicating data. Full UI management for ES connections, per-system event source selection, and ECS field flattening.**

---

## What's New in v0.8.0

### Elasticsearch Integration (Hybrid Architecture)

- **EventSource abstraction layer** — Storage-agnostic interface (`EventSource`) with PostgreSQL (`PgEventSource`) and Elasticsearch (`EsEventSource`) implementations. Each monitored system chooses its event source independently.
- **ES Connection Management** — Full CRUD for Elasticsearch connections via Settings > Elasticsearch. Supports Basic auth, API Key, and Elastic Cloud ID authentication. Test connections before saving.
- **Index Browser** — Browse indices, inspect field mappings, and preview sample documents directly from the UI to configure field mapping.
- **Per-System ES Configuration** — When creating or editing a monitored system, select "Elasticsearch (external)" as event source. Configure index pattern, timestamp/message field mapping, and optional query filters.
- **Read-Only ES Access** — LogSentinel AI never writes to or deletes from your Elasticsearch cluster. AI analysis results, acknowledgments, and metadata are stored in PostgreSQL.
- **ECS Field Flattening** — Elastic Common Schema nested fields (e.g., `host.name`, `source.ip`, `log.level`) are automatically flattened during ingest for compatibility with the scoring pipeline.
- **Database Info Card** — Expandable PostgreSQL server info (version, database size, partitioning status, top tables by size) in Settings > Database.
- **ES Health Dashboard** — Connection status, last health check, and cluster info visible in the Elasticsearch settings and Database Info panels.

### Pipeline Enhancements

- **System-aware EventSource dispatch** — AI scoring, meta-analysis, windowing, and maintenance jobs now dispatch to the correct EventSource per system (PostgreSQL or Elasticsearch).
- **ES event scoring** — Events from Elasticsearch are scored the same way as PostgreSQL events. Scores and template assignments are stored in PostgreSQL (`event_scores`, `es_event_metadata`).
- **ES acknowledgment support** — Acknowledging events for ES-backed systems stores metadata in PostgreSQL without modifying the Elasticsearch index.

### Built-in Log Collector (Fluent Bit)

- **Syslog receiver** — UDP (RFC 3164) and TCP (RFC 5424) on configurable port (default 5140). Accepts logs from routers, switches, firewalls, rsyslog, syslog-ng.
- **OpenTelemetry receiver** — OTLP/HTTP and OTLP/gRPC on a single port (default 4318). Accepts logs, metrics, and traces from OTel Collectors, SDKs, and agents.
- **Docker profile** — Deploy with `docker compose --profile collector up -d`. Requires `INGEST_API_KEY` in `.env`.
- **Health monitoring** — Fluent Bit health and Prometheus metrics on port 2020.
- **Custom parsers** — Included parsers for RFC 3164, RFC 5424, bare syslog, and JSON.

### Database Migration

- **Migration 021** — Adds `event_source`, `es_config`, `es_connection_id` columns to `monitored_systems`. Creates `elasticsearch_connections` and `es_event_metadata` tables. Widens `event_scores.event_id` to `VARCHAR(255)` for ES document IDs.

---

## Upgrading from v0.7.x

1. Pull the latest code and rebuild Docker images.
2. Migration 021 runs automatically on startup — no manual SQL needed.
3. Existing systems default to `event_source = 'postgresql'` — no behavior change.
4. To connect to Elasticsearch: go to Settings > Elasticsearch > Add Connection.
5. To enable the log collector: set `INGEST_API_KEY` in `.env`, then run `docker compose --profile collector up -d`.
5. To enable the log collector: set `INGEST_API_KEY` in `.env` and add `--profile collector`.

---

---

# LogSentinel AI v0.7.2-beta — Security Hardening & Consistency

**Comprehensive security hardening, audit coverage, CSS/UI consistency, and Docker reliability improvements.**

Upgrade from v0.7.0 or v0.7.1 is strongly recommended.

---

## What's New in v0.7.2

### Security Hardening

- **ILIKE Wildcard Injection Fix** — User input in event search, trace search, and audit log actor filter is now escaped for `%` and `_` wildcards before ILIKE queries, preventing pattern injection (OWASP A03).
- **Multi-Permission Auth** — `requireAuth()` now accepts an array of permissions (OR logic), enabling finer-grained access control on shared endpoints.
- **Systems Audit Logging** — Create, update, and delete operations on monitored systems now produce immutable audit log entries. Previously the only CRUD module without audit coverage.
- **Date Validation Order** — Event acknowledge/unacknowledge endpoints now validate date inputs *before* parsing, preventing uncaught exceptions on malformed dates.

### Bug Fixes — Backend (v0.7.1 + v0.7.2)

- **Transactional Role Operations** — Role creation and permission updates wrapped in DB transactions.
- **Invalid Role Rejection** — Creating a user with a non-existent role returns HTTP 400 instead of silently defaulting.
- **Unknown Permission Rejection** — Invalid permission names return HTTP 400 instead of being silently dropped.
- **Administrator Protection** — Cannot strip all permissions from the `administrator` role via API.
- **Cache TTL Fix** — Synchronous permission cache respects the 30-second TTL.
- **Roles Read Access** — GET `/api/v1/roles` now accepts either `users:manage` or `roles:manage` permission, so custom roles with only `roles:manage` can use the roles editor.
- **Logging Consistency** — `localTimestamp()` added to all remaining log statements (redact.ts, API key errors).

### Bug Fixes — Frontend (v0.7.1 + v0.7.2)

- **Missing CSS Variables** — Added `--danger`, `--muted`, and `--surface` to `:root`. Inline styles referencing these now render correctly.
- **Missing CSS Classes** — Added `btn-success-outline`, `btn-primary`, and `badge-ok`. Buttons and badges previously had no visual styling.
- **CSS Selector Fix** — `.tok-opt-row input` selector updated to match `NumericInput` rendered type (`text` instead of `number`).
- **Input Type Consistency** — Replaced all remaining `type="number"` inputs in SystemForm and SourceForm with `type="text" inputMode="numeric"` to prevent snapping.
- **Audit Log Export Dates** — Export now converts EU dates to ISO format before sending to server.
- **Role Editor** — Dirty state no longer polluted by Create modal; edit form re-syncs after save.
- **User Management Fallback** — Role dropdown shows defaults when API is unavailable.
- **NumericInput NaN Guard** — Displays `0`/`min` instead of literal "NaN" text.
- **Date Format** — All dates across the entire dashboard consistently use `DD-MM-YYYY` format.
- **Number Inputs** — All numeric inputs allow free clearing before typing a new value.

### Docker & Infrastructure

- **Health-Aware Startup** — Backend now waits for PostgreSQL health check when using `--profile db`. Dashboard waits for backend.
- **Version Alignment** — Backend and dashboard `package.json` versions synchronized to `0.7.2`.

### Documentation

- **INSTALL.md** — OpenAI API key correctly marked as optional; troubleshooting section updated.
- **RELEASE_NOTES.md** — Comprehensive changelog for all changes since v0.7.0.

---

## Deployment Options

### Option A — All-in-One (PostgreSQL included)

Everything runs inside Docker — no external database needed.

```bash
git clone https://github.com/PhilipLykov/LogSentinelAI.git
cd LogSentinelAI/docker
cp .env.example .env
# Edit .env: set DB_PASSWORD (pick any strong password)
# Set DB_HOST=postgres

docker compose --profile db up -d --build
docker compose logs backend | grep -A 5 "BOOTSTRAP"
# Open http://localhost:8070
```

### Option B — External PostgreSQL (bring your own database)

Backend and dashboard run in Docker; you point them at your existing PostgreSQL server.

```bash
git clone https://github.com/PhilipLykov/LogSentinelAI.git
cd LogSentinelAI/docker
cp .env.example .env
# Edit .env: set DB_HOST=<your-pg-server> and DB_PASSWORD

docker compose up -d --build
docker compose logs backend | grep -A 5 "BOOTSTRAP"
# Open http://localhost:8070
```

> AI model and API key are configured after login via **Settings > AI Model** in the web UI.

See [INSTALL.md](https://github.com/PhilipLykov/LogSentinelAI/blob/master/INSTALL.md) for the complete deployment guide.

## Upgrading from v0.7.0 or v0.7.1

```bash
cd LogSentinelAI
git pull
cd docker
docker compose up -d --build
# Migrations run automatically on startup
```

---

**Full documentation**: [README.md](https://github.com/PhilipLykov/LogSentinelAI/blob/master/README.md) | [INSTALL.md](https://github.com/PhilipLykov/LogSentinelAI/blob/master/INSTALL.md)
