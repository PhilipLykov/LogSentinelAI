# LogTide: Overview and Possibilities

**Source:** [logtide.dev](https://logtide.dev), [GitHub logtide-dev/logtide](https://github.com/logtide-dev/logtide), official docs.  
**Status:** Alpha (actively developed). Formerly named LogWard.

---

## 1. What Is LogTide?

LogTide is an **open-source, privacy-first log management platform** designed as a lighter alternative to Datadog, Splunk, and ELK. It provides:

- **Collect** — Ingest logs from apps, syslog, Docker, OpenTelemetry.
- **Store** — TimescaleDB (PostgreSQL with time-series extensions).
- **Search** — Full-text and substring search, filters, time range.
- **Analyze** — SIEM dashboard, Sigma rules, incident management, optional AI (you add it).

**Tech stack:** Fastify (Node.js) + TypeScript, SvelteKit frontend, TimescaleDB, optional Redis. **License:** AGPL-3.0 (free for internal use; SaaS requires source release or commercial license).

---

## 2. Deployment Options

| Option | Description |
|--------|-------------|
| **Self-hosted Docker** | Pre-built images (Docker Hub / GHCR). `docker compose up -d`. Frontend :3000, API :8080. |
| **Simplified (no Redis)** | `docker-compose.simple.yml` — fewer containers, PostgreSQL-only for queue/cache. Good for &lt;1000 logs/sec, Raspberry Pi, homelab. |
| **With Fluent Bit (syslog)** | `--profile logging` adds Fluent Bit; exposes **UDP/TCP 514** for syslog (RFC 3164/5424). |
| **Kubernetes (Helm)** | Official Helm chart: multi-replica backend/worker, HPA, Ingress, Prometheus. |
| **Cloud (Alpha)** | Hosted at `api.logtide.dev` — free during Alpha; EU-friendly. |

**Production tip:** Pin image versions in `.env` (e.g. `logtide/backend:0.5.3`).

---

## 3. Ingestion and Syslog

### How logs get in

- **HTTP API** — `POST /api/v1/ingest` with `X-API-Key: lp_...`. Batch up to 1000 logs per request.
- **SDKs** — Node.js, Python, Go, PHP, Kotlin, C#/.NET (retry + circuit breaker).
- **Syslog** — Via **Fluent Bit** (when using `--profile logging`): listens on **port 514 UDP/TCP**, RFC 3164 and RFC 5424. Suitable for network devices, hypervisors (Proxmox, ESXi), Linux servers, routers (e.g. UniFi, pfSense, MikroTik).
- **OpenTelemetry** — Native OTLP (logs + traces), protobuf and JSON.
- **Docker** — Fluent Bit can collect container logs and forward to LogTide API.

So for **syslog**: enable the logging profile, point your devices/servers to `&lt;logtide-host&gt;:514`, and ensure `FLUENT_BIT_API_KEY` is set so Fluent Bit can send to the backend.

---

## 4. Search and Query

- **Full-text search** — Word-based with stemming on the message field.
- **Substring search** — Find any string in messages (e.g. `bluez` in `spa.bluez5.native`).
- **Filters** — By `service`, `level`, time range (`from` / `to`).
- **API** — `GET /api/v1/logs` with query params: `q`, `service`, `level`, `from`, `to`, `limit`, `offset`.
- **Live tail** — Server-Sent Events (SSE) at `/api/v1/logs/stream` for real-time log streaming.

---

## 5. Alerts and Notifications

- **Alert rules** — Conditions on fields (e.g. `level` = error), threshold, time window (e.g. 5m).
- **Channels** — Email, **Webhook** (Slack, Discord, custom).
- **Alert preview** — Test rules against historical data before enabling (v0.5.0+).
- **API** — Create/list alerts per project via REST (Bearer token for dashboard auth).

---

## 6. SIEM and Security (Sigma Rules)

- **Sigma rules** — Industry-standard YAML detection rules; import from [SigmaHQ/sigma](https://github.com/SigmaHQ/sigma) or write your own.
- **Real-time matching** — Rules evaluated against incoming logs.
- **SIEM dashboard** — Summary stats, top threats, detection timeline, severity distribution, **MITRE ATT&CK heatmap**.
- **Incident management** — Workflow: Open → Investigating → Resolved / False Positive; comments, activity timeline, **PDF export** for reports.
- **Detection packs** — Pre-configured Sigma rule bundles for common use cases (v0.5.0+).

So LogTide can act as a **lightweight SIEM** (threat detection + incidents) on top of the same log store.

---

## 7. Observability (Traces, Correlation)

- **Distributed tracing** — OTLP traces; trace viewer with span timeline and service dependency graph.
- **Trace-to-logs** — Jump from a trace/span to related logs.
- **Event correlation** — Link logs by `request_id`, `trace_id`, `user_id`, or custom fields (v0.5.0+).

Useful when you send both logs and traces (e.g. from OpenTelemetry) to LogTide.

---

## 8. Retention and Cleanup

- **Documented feature:** “Retention Policy: Automatic cleanup of old logs via TimescaleDB.”
- **Mechanism:** Logs are stored in TimescaleDB hypertables; retention is typically implemented with TimescaleDB’s **retention policies** (e.g. `add_retention_policy` to drop chunks older than X days).
- **Exact defaults** (e.g. 7 days, 30 days) are not clearly stated in the public docs; for self-hosted you can add or adjust retention policies directly in the database if needed.

---

## 9. Multi-Tenancy and Access

- **Organizations and projects** — Multi-org support; data isolated per organization/project.
- **Auth** — **Session (Bearer)** for dashboard and management APIs; **API keys** (project-scoped, `lp_` prefix) for ingest and log query.
- **API key secret** — `API_KEY_SECRET` in `.env` (32+ chars) used to encrypt/secure API keys.

---

## 10. Scalability and Resilience

- **Without Redis** — Single instance; cache and queue use PostgreSQL (graphile-worker). Suitable for low/medium volume and homelab.
- **With Redis** — Rate limiting, job queue (BullMQ), optional cache; required for **horizontal scaling** (multiple backends/workers).
- **Horizontal scaling** — Use `docker-compose.traefik.yml` overlay; scale backend and worker; Redis required. Traefik exposes a single port (default 3080) for frontend + API.

---

## 11. What LogTide Does *Not* Include (Where You Add Your Own)

- **No built-in AI/LLM** — No “explain this log” or “summarize these errors” in the box. You add that by:
  - Calling your own API (e.g. OpenAI, local LLM) with selected log text, or
  - A small side service that queries LogTide API and sends excerpts to an AI, then shows the result (e.g. “Analyze” button in a custom UI or script).

---

## 12. Quick Reference: Capabilities at a Glance

| Area | Possibilities |
|------|----------------|
| **Ingestion** | HTTP API, SDKs (Node, Python, Go, PHP, Kotlin, C#), **syslog (514)** via Fluent Bit, OTLP, Docker logs |
| **Storage** | TimescaleDB (PostgreSQL); optional external PG+TimescaleDB |
| **Search** | Full-text, substring, filters (service, level, time), API, live tail (SSE) |
| **Alerts** | Rules on level/threshold/time window; email, webhook (Slack/Discord) |
| **SIEM** | Sigma rules, detection packs, incident workflow, MITRE ATT&CK, PDF reports |
| **Observability** | OTLP traces, trace viewer, trace-to-logs, event correlation |
| **Deployment** | Docker (full/simple), Kubernetes/Helm, Cloud Alpha |
| **Retention** | Automatic via TimescaleDB (details configurable in DB if self-hosted) |
| **AI** | Not built-in; add via your own API or side service |

---

## 13. Links

- **Product and docs:** [logtide.dev](https://logtide.dev) · [logtide.dev/docs](https://logtide.dev/docs)
- **Repo:** [github.com/logtide-dev/logtide](https://github.com/logtide-dev/logtide)
- **Deployment:** [logtide.dev/docs/deployment](https://logtide.dev/docs/deployment)
- **API:** [logtide.dev/docs/api](https://logtide.dev/docs/api)
- **Docker images:** [Docker Hub logtide/backend](https://hub.docker.com/r/logtide/backend) · [GHCR](https://github.com/logtide-dev/logtide/pkgs/container/logtide-backend)
- **Sigma rules:** [github.com/SigmaHQ/sigma](https://github.com/SigmaHQ/sigma)

If you tell me your priority (e.g. syslog only, SIEM, or adding AI on top), I can outline a concrete setup (e.g. Docker + Fluent Bit + optional AI bridge).
