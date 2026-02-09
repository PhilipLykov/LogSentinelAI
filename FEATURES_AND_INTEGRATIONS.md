# Features and Integrations — Product Scope

**Purpose:** This document lists all **accepted features** (including ideas from AI market research), **notification integrations** (Pushover, Telegram, webhooks), and the **connector architecture** so the product works as a **comprehensive AI log audit and analysis solution** that can connect to **different log collection and storage systems**, not only a single chosen stack.

**Context:** See **PROJECT_INSTRUCTIONS.md**, **AI_ANALYSIS_SPEC.md**, **MARKET_RESEARCH_AI_LOG_ANALYSIS.md**.

---

## 1. Product positioning

- The product is a **comprehensive AI log audit and analysis solution**: it ingests or consumes logs, runs per-event and meta-analysis (6 criteria, scoring, blend), and outputs scores, findings, and alerts.
- It must be **usable with different log collection and store solutions** (e.g. LogTide, VictoriaLogs, Elasticsearch, Loki, Grafana, syslog-ng, Fluent Bit, Vector, or custom pipelines). The product is **not tied** to one specific collector or store chosen for a single installation.
- **Architecture:** Provide **connectors/adapters** for:
  - **Ingestion:** Consume logs from multiple backends (API, query, stream, webhook, or file) so users can plug in their existing collector/stack.
  - **Output (optional):** Write analysis results (scores, findings, meta) back to a store or forward to external systems (webhook, SIEM, etc.).

---

## 2. Connector architecture (connect with other log systems)

### 2.1 Goal

- Users may already have **log collection** (e.g. syslog → rsyslog, Fluent Bit, Vector) and **log storage** (e.g. Elasticsearch, Loki, VictoriaLogs, LogTide, S3, files). The product should **consume logs from** and optionally **publish results to** these systems instead of requiring a single built-in stack.
- The product acts as an **AI analysis layer** that can sit **alongside** or **on top of** existing log infrastructure.

### 2.2 Ingestion connectors (log input)

Support one or more **input adapters** so logs can be fed into the analysis pipeline from:

| Connector type | Description | Example backends |
|----------------|-------------|------------------|
| **Push / webhook** | Logs sent to our HTTP endpoint (e.g. from Fluent Bit, Vector, custom app). | Any collector that can HTTP POST. |
| **Pull / API** | We periodically query an external API for recent logs (e.g. Elasticsearch, LogTide, Loki, custom). | Elasticsearch, LogTide, Loki, Grafana Loki, OpenSearch. |
| **Stream / tail** | Consume a log stream (e.g. syslog TCP/UDP, or tail files). | rsyslog, syslog-ng, file tail. |
| **Message queue** | Consume from a queue (e.g. Kafka, RabbitMQ, Redis Streams). | Kafka, RabbitMQ, Redis. |
| **File / object storage** | Poll or watch for new log files (e.g. S3, local path, SFTP). | S3, Azure Blob, local directory, SFTP. |

- **Configuration:** Each connector type is configurable (URL, credentials, query, filters). Users enable the connectors that match their existing stack. Default or reference setup can still include a **built-in** lightweight collector (e.g. syslog + optional store) for users who want all-in-one.
- **Normalization:** Incoming logs are **normalized** to a common internal schema (timestamp, message, severity, source, host, service, optional fields) so the rest of the pipeline (dedup, scoring, meta) is backend-agnostic.

### 2.3 Output connectors (optional)

- **Store results internally** (our own DB/store) for dashboard and API.
- **Forward to external systems:** Webhooks, SIEM (e.g. Splunk, Elastic), PagerDuty, Slack, **Pushover**, **Telegram** (see §4). Optional: write scores/findings back to a log store (e.g. Elasticsearch index) for correlation with raw logs.
- **Export:** Compliance reports (PDF, JSON, CSV), scheduled reports (email, etc.).

### 2.4 Summary

- **In:** Logs come from **user’s chosen** collectors/stores via adapters (webhook, pull API, stream, queue, or file).
- **Core:** Our pipeline (dedup, preprocessing, per-event scoring, meta-analyze, blend) and storage of scores/findings are **independent** of the source backend.
- **Out:** Dashboard, API, webhooks, Pushover, Telegram, and optional export/back-write to external systems.

---

## 3. Accepted features (from AI market research)

All ideas from **MARKET_RESEARCH_AI_LOG_ANALYSIS.md** §4 are **accepted** as part of the product scope. Implement in phases (see priorities in that doc).

### 3.1 Strong fit (adopt or extend)

| # | Feature | Brief description |
|---|---------|-------------------|
| 1 | **Severity labels (CRITICAL/HIGH/MEDIUM/LOW)** | Map 0–1 score to bands (e.g. 0.75–1 → CRITICAL). Store and show in API, dashboard, exports. |
| 2 | **Recommended action** | LLM outputs a short recommended action (meta and optionally per-event). Show in dashboard and reports. |
| 3 | **Compliance-ready report export** | PDF or structured (JSON/CSV) export of findings and scores; optional templates (e.g. SOC 2, incident summary). |
| 4 | **Webhooks / outbound integrations** | On threshold or schedule, send webhook (SIEM, Slack, PagerDuty, etc.) with summary, severity, link. Configurable per system/criterion. |
| 5 | **Natural language query (RAG)** | “Ask” or “Explain” UX: plain-language questions over logs + scores + meta; RAG-backed short answers. |
| 6 | **Root cause / key events in meta-output** | Meta-analyze returns minimal set of key events/templates that best explain the situation; show as “likely root cause” in drill-down. |
| 7 | **MITRE ATT&CK mapping for security** | For IT Security criterion, map findings to MITRE ATT&CK technique IDs; store and display in dashboard/reports. |
| 8 | **Cost visibility per analysis** | Track and expose cost per window or per system per day (tokens/API cost). |

### 3.2 Medium fit (consider)

| # | Feature | Brief description |
|---|---------|-------------------|
| 9 | **Detection profiles or analysis templates** | Profile per system/source (e.g. “auth-focused”, “compliance-only”) to emphasize criteria or prompts. |
| 10 | **Suggested follow-up questions** | In dashboard, suggest questions (e.g. “Drill into Failure prediction”) — static or LLM-generated. |
| 11 | **Scheduled reports** | Scheduled job (e.g. daily): meta-summary per system, email or send report. |
| 12 | **Baseline / anomaly learning (optional)** | Simple baseline (rate, template distribution) per system/source; flag deviations for Anomaly criterion; can reduce LLM cost. |

### 3.3 Longer-term (optional)

| # | Feature | Brief description |
|---|---------|-------------------|
| 13 | **Confidence score** | LLM returns confidence (0–1) per criterion or meta-result; use for filtering/ranking. |
| 14 | **Repository / scheduled pull** | Pull logs from S3, Azure, GitHub, SFTP on schedule; run pipeline (batch/air-gap friendly). |
| 15 | **Fine-tuned small model for per-event scoring** | Train small classifier on 6-criteria labels for cheaper per-event scoring; LLM for meta and edge cases. |

---

## 4. Notification channels

In addition to **webhooks** (§3.1.4), the product must support the following notification channels so users can receive alerts and reports where they prefer.

### 4.1 Pushover (and similar push services)

- **Pushover** (pushover.net): mobile and desktop push notifications via simple API (token + user key, message, optional title, priority, URL).
- **Integration:** When effective score or meta-score exceeds a threshold, or on scheduled report, send a **push notification** via Pushover API. Configurable per channel (e.g. per system, per severity).
- **Similar services:** Design the **notification layer** so other push-style services (e.g. **Gotify**, **NTfy**, **Bark**, or generic HTTP push endpoints) can be added with the same pattern: config (URL, token/key), payload (title, body, severity, link to dashboard). Prefer a **generic “push” connector** with a **Pushover adapter** as one implementation; document how to add others.

### 4.2 Telegram

- **Telegram:** Send messages to a user or group via the **Telegram Bot API** (bot token, chat ID). Supports text, optional formatting, and links.
- **Integration:** When effective score or meta-score exceeds a threshold, or on scheduled report, send a **Telegram message** (e.g. summary, severity, link to dashboard). Configurable per bot/chat (e.g. per system or per environment).
- **Configuration:** User provides **Bot Token** (from @BotFather) and **Chat ID** (user or group). Optional: different chats for different severity levels or systems.

### 4.3 Unified notification config

- **Channels:** Webhook, **Pushover** (and similar push), **Telegram**, and optionally email (if not already covered by webhook/SMTP). Each channel can be enabled/disabled and configured (thresholds, systems, severity filter).
- **Payload:** Common payload shape (title, body, severity, effective scores or top findings, link to dashboard) so each channel adapter maps it to the provider’s format (e.g. Pushover message, Telegram text, webhook JSON).

---

## 5. Feature checklist (summary)

| Area | Features |
|------|----------|
| **Core (existing spec)** | 6 criteria, per-event + meta scores, blend, system description, log sources, dashboard, cost control (dedup, preprocessing). |
| **From market research** | Severity labels, recommended action, compliance export, webhooks, RAG/NL query, root cause/key events, MITRE ATT&CK, cost visibility; detection profiles, suggested questions, scheduled reports, baseline learning; confidence score, repository pull, fine-tuned model. |
| **Notifications** | Webhooks, **Pushover** (and similar push), **Telegram**. |
| **Connectivity** | **Connectors** for ingestion from and optional output to **other log collection and store systems** (API pull, webhook push, stream, queue, file/S3); normalization; product usable as AI layer on top of existing stacks. |

---

## 6. Security

- The solution must be **secure by design** and follow **OWASP Top 10**. See **SECURITY_OWASP.md** for requirements (access control, crypto, injection, SSRF, logging, etc.) applied to APIs, connectors, dashboard, and deployment.

---

## 7. References

- **Instructions:** PROJECT_INSTRUCTIONS.md (Instruction 10: add all ideas, Pushover/Telegram, connect with other log systems; Instruction 11: OWASP Top 10, secure by design).
- **Analysis spec:** AI_ANALYSIS_SPEC.md.
- **Security:** SECURITY_OWASP.md.
- **Market research:** MARKET_RESEARCH_AI_LOG_ANALYSIS.md.

When implementing, read **PROJECT_INSTRUCTIONS.md**, **AI_ANALYSIS_SPEC.md**, and **SECURITY_OWASP.md**; use this document for the full feature set and connector/notification design.
