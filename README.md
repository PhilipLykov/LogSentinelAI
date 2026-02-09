# SyslogCollectorAI — AI Log Audit & Analysis

Lightweight, connector-based system that **collects** logs, **stores** them, and **analyzes** with AI across 6 criteria: IT Security, Performance Degradation, Failure Prediction, Anomaly, Compliance/Audit, and Operational Risk.

> **Secure by design** — follows [OWASP Top 10](./SECURITY_OWASP.md). All secrets stay in env; no plaintext keys in DB.

## Architecture

```
Ingestion (webhook / pull connectors / syslog)
    ↓
Normalize → Source Match → Redact (optional) → Persist events
    ↓
Dedup & Template Extraction → Per-Event LLM Scoring (6 criteria)
    ↓
Windowing → Meta-Analyze (LLM, joint review) → Effective Score (blend)
    ↓
Dashboard (React)  ←→  Alerting (webhook, Pushover, NTfy, Gotify, Telegram)
```

## Quick start (development)

### Prerequisites

- **Node.js** >= 20
- **PostgreSQL** >= 14

### 1. Clone & install

```bash
cd backend
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
```

### 3. Create the database

```sql
CREATE DATABASE syslog_collector_ai;
CREATE USER syslog_ai WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE syslog_collector_ai TO syslog_ai;
-- Required for uuid-ossp extension:
\c syslog_collector_ai
GRANT CREATE ON SCHEMA public TO syslog_ai;
```

### 4. Run

```bash
npm run dev
```

On first start, the server will:
1. Run database migrations (create all tables)
2. Seed the 6 analysis criteria
3. Generate an admin API key (printed to console — **save it**)

### 5. Run dashboard (optional)

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:5173` and enter your admin API key.

## Docker (production)

```bash
cd docker
export DB_PASSWORD=secure_password_here
export OPENAI_API_KEY=sk-...
docker compose up -d
```

Services:
- **backend** on port `3000` (API + pipeline)
- **dashboard** on port `8070` (React UI)
- **db** PostgreSQL 16

## API endpoints

All endpoints require `X-API-Key` header.

### Ingest

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `POST` | `/api/v1/ingest` | ingest, admin | Ingest batch of log events |

### Config (Systems & Sources)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/api/v1/systems` | admin, read, dashboard | List monitored systems |
| `POST` | `/api/v1/systems` | admin | Create system |
| `PUT` | `/api/v1/systems/:id` | admin | Update system |
| `DELETE` | `/api/v1/systems/:id` | admin | Delete system |
| `GET` | `/api/v1/sources` | admin, read, dashboard | List log sources |
| `POST` | `/api/v1/sources` | admin | Create log source |
| `PUT` | `/api/v1/sources/:id` | admin | Update log source |
| `DELETE` | `/api/v1/sources/:id` | admin | Delete log source |

### Scores & Dashboard

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/api/v1/scores/systems` | admin, read, dashboard | Effective scores per system |
| `GET` | `/api/v1/scores/stream` | admin, read, dashboard | SSE stream of score updates |
| `GET` | `/api/v1/dashboard/systems` | admin, read, dashboard | Dashboard overview |
| `GET` | `/api/v1/systems/:id/events` | admin, read, dashboard | Drill-down: events |
| `GET` | `/api/v1/systems/:id/meta` | admin, read, dashboard | Drill-down: meta analysis |
| `GET` | `/api/v1/windows` | admin, read, dashboard | List windows |
| `GET` | `/api/v1/events/:id/scores` | admin, read, dashboard | Event scores |
| `GET` | `/api/v1/windows/:id/meta` | admin, read, dashboard | Meta result for window |

### Alerting

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET/POST/PUT/DELETE` | `/api/v1/notification-channels` | admin | CRUD channels |
| `POST` | `/api/v1/notification-channels/:id/test` | admin | Test notification |
| `GET/POST/PUT/DELETE` | `/api/v1/notification-rules` | admin | CRUD rules |
| `GET/POST/DELETE` | `/api/v1/silences` | admin | CRUD silences |
| `GET` | `/api/v1/alerts` | admin, read, dashboard | Alert history |

### Connectors

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `GET` | `/api/v1/connectors/types` | admin | Available connector types |
| `GET/POST/PUT/DELETE` | `/api/v1/connectors` | admin | CRUD connectors |

### Features (Phase 7)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| `POST` | `/api/v1/export/compliance` | admin | Compliance export (CSV/JSON) |
| `POST` | `/api/v1/ask` | admin, read, dashboard | RAG natural language query |
| `GET/PUT` | `/api/v1/config` | admin | App configuration |
| `GET` | `/api/v1/costs` | admin | LLM cost visibility |
| `GET` | `/api/v1/llm-usage` | admin | Detailed LLM usage records |

## Connecting log shippers

### Fluent Bit

```ini
[OUTPUT]
    Name        http
    Match       *
    Host        your-server
    Port        3000
    URI         /api/v1/ingest
    Format      json
    Header      X-API-Key YOUR_INGEST_KEY
    json_date_key timestamp
    json_date_format iso8601
```

### Vector

```toml
[sinks.syslog_ai]
  type = "http"
  inputs = ["your_source"]
  uri = "http://your-server:3000/api/v1/ingest"
  encoding.codec = "json"
  headers.X-API-Key = "YOUR_INGEST_KEY"
```

### Logstash

```ruby
output {
  http {
    url => "http://your-server:3000/api/v1/ingest"
    http_method => "post"
    format => "json"
    headers => { "X-API-Key" => "YOUR_INGEST_KEY" }
  }
}
```

## Redaction (optional)

Set `REDACTION_ENABLED=true` to strip secrets/passwords from log content **before** storage and AI analysis. Built-in patterns cover:
- Passwords (`password=`, `passwd=`)
- API keys (`api_key=`, `token=`)
- Bearer tokens (`Authorization: Bearer ...`)
- Connection strings with embedded credentials

Add custom patterns via `REDACTION_PATTERNS` (comma-separated regexes).

## Alerting channels

| Channel | Config keys | Notes |
|---------|------------|-------|
| **Webhook** | `url` | POST JSON payload to URL |
| **Pushover** | `token_ref`, `user_key` | Priority mapped from severity |
| **NTfy** | `base_url`, `topic`, `auth_header_ref?` | Topic should be unguessable |
| **Gotify** | `base_url`, `token_ref` | App token from Gotify server |
| **Telegram** | `token_ref`, `chat_id` | Bot API, MarkdownV2 |

All `*_ref` fields use `env:VAR_NAME` format to reference environment variables (secrets never stored in DB).

## Security (OWASP Top 10)

| Control | Implementation |
|---------|---------------|
| A01 Broken Access Control | API key auth on all endpoints; scope-based access |
| A02 Cryptographic Failures | Keys stored as SHA-256 hashes; secrets from env only |
| A03 Injection | Parameterized queries via Knex; prompt sanitization |
| A04 Insecure Design | Defense-in-depth; rate limiting; audit log |
| A05 Security Misconfiguration | Secure headers (Helmet); non-root Docker; no default passwords |
| A07 Auth Failures | Generic error messages; rate-limited; no key enumeration |
| A09 Security Logging | Structured logs (Europe/Chisinau TZ); audit_log table; no secrets in logs |
| A10 SSRF | URL validation on webhooks, connectors, notification channels |

See [SECURITY_OWASP.md](./SECURITY_OWASP.md) for full details.

## Project docs

| Document | Contents |
|----------|----------|
| [PROJECT_INSTRUCTIONS.md](./PROJECT_INSTRUCTIONS.md) | All user requirements |
| [AI_ANALYSIS_SPEC.md](./AI_ANALYSIS_SPEC.md) | Scoring, meta-analysis, dashboard |
| [FEATURES_AND_INTEGRATIONS.md](./FEATURES_AND_INTEGRATIONS.md) | Connectors, notifications, features |
| [SECURITY_OWASP.md](./SECURITY_OWASP.md) | OWASP Top 10 mapping |
