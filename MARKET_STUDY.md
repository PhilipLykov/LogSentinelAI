# Market Study: Syslog Collect, Store, Search & AI Analysis

**Date:** 2026-02-06  
**Requirements:** Free/open source, lightweight, Docker, **any database** (no preference for PostgreSQL); AI part may be paid.

---

## 1. Requirements Summary

| Requirement        | Detail |
|--------------------|--------|
| Collect           | Syslog (RFC 3164 / RFC 5424) |
| Store             | Any DB (PostgreSQL, TimescaleDB, DuckDB, proprietary log DB, etc.) |
| Search            | Full-text and filtered search over stored logs |
| Analyze with AI   | Optional; may use paid AI (e.g. OpenAI) or self-hosted LLM |
| Cost              | Free (except AI); preferably open source |
| Deployment        | Lightweight, runs on your Docker |

---

## 2. Candidates Evaluated

### 2.1 LogTide (ex-Logward)

- **What it is:** Open-source log management (collect, store, search, SIEM, alerts). Privacy-first, lightweight vs ELK.
- **License:** AGPL-3.0.
- **Storage:** **PostgreSQL 16 + TimescaleDB** (TimescaleDB is a PostgreSQL extension).
- **Deployment:** Docker Compose (backend, frontend, worker, Fluent Bit for syslog, optional Redis; can use PostgreSQL-only for queue since v0.5.0).
- **Syslog:** Yes — via Fluent Bit (RFC 3164/5424), port 514 UDP/TCP; from hypervisors, network devices, Linux.
- **Search:** Full-text and substring, filters (service, level, time).
- **AI:** No built-in AI analysis.
- **Database:** Compose includes `timescale/timescaledb:latest-pg16` by default; you can also point `DATABASE_URL` at an external PostgreSQL with TimescaleDB if desired.
- **Verdict:** **Best fit** for a complete solution: collect, store, search, UI, SIEM, alerts out of the box. Run as-is with its included TimescaleDB container, or use external PG+TimescaleDB.
**Links:** [GitHub logtide-dev/logtide](https://github.com/logtide-dev/logtide), [logtide.dev](https://logtide.dev), [Syslog docs](https://logtide.dev/docs/syslog).

---

### 2.2 Graylog Open

- **What it is:** Centralized log management (collect, search, dashboards, alerts).
- **License:** SSPL (source-available), free for self-hosted.
- **Storage:** **MongoDB** for config/metadata; **Elasticsearch/OpenSearch** for log storage and search. **No PostgreSQL backend** for core logs.
- **Syslog:** Yes (native inputs).
- **Search:** Yes (via Elasticsearch/OpenSearch).
- **AI:** No built-in AI analysis.
- **Verdict:** Heavy stack (MongoDB + Elasticsearch/OpenSearch). Not lightweight; other options are simpler for Docker.

---

### 2.3 VictoriaLogs

- **What it is:** Log database and query engine, very efficient for large volumes.
- **License:** Open source (Apache-style).
- **Storage:** **Proprietary storage** (not PostgreSQL). Optimized for logs (compression, low disk/RAM).
- **Deployment:** Docker, single binary; can receive logs via various agents (e.g. Vector, Fluent Bit).
- **Verdict:** **Lightest** option; excellent compression and performance. Own storage (no PG). Use with Vector/Fluent Bit for syslog; add AI via API or Grafana/custom UI.

---

### 2.4 Sloggo

- **What it is:** Minimal RFC 5424 syslog collector and viewer.
- **Storage:** **DuckDB** (embedded analytical DB), single process.
- **License:** MIT.
- **Verdict:** Lightweight, single process, DuckDB. Good for small-scale; no AI built-in.

---

### 2.5 rsyslog + PostgreSQL (ompgsql)

- **What it is:** rsyslog module `ompgsql` writes syslog **directly to PostgreSQL**.
- **Storage:** **PostgreSQL**.
- **Limitations:** Ingestion only. **No built-in UI, no search interface, no AI.** You’d need to build or add a separate app for search and AI.
- **Verdict:** Useful as collector in a **custom** stack if we choose PG as the store.

---

### 2.6 syslog-ng

- **What it is:** Log router/collector with many outputs (files, SQL, NoSQL, Kafka, etc.).
- **Storage:** Can write to PostgreSQL (e.g. via destination drivers). Like rsyslog, it does **not** provide a ready-made search UI or AI — it’s the pipeline, not the full product.
- **Verdict:** Viable as **collector + writer to PostgreSQL** in a custom stack.

---

### 2.7 ELK / Elastic Stack (Elasticsearch, Logstash, Kibana)

- **What it is:** The classic open-source log stack: **Elasticsearch** (store + search), **Logstash** or **Filebeat** (collect), **Kibana** (UI, dashboards, search). Industry standard for log aggregation and analytics.
- **License:** Elastic moved from Apache 2.0 to **SSPL** (Server Side Public License) from 7.11; some features are proprietary. **OpenSearch** (AWS) is the Apache-2.0 fork of Elasticsearch with OpenSearch Dashboards (Kibana fork) — fully open source if you use that distribution.
- **Storage:** **Elasticsearch** (Lucene-based search engine). Excellent full-text search and scaling.
- **Deployment:** Docker / Docker Compose (e.g. `sebp/elk` or official images). Logstash can receive syslog; Filebeat can ship logs to Logstash/Elasticsearch.
- **Syslog:** Yes — via Logstash syslog input or Beats (e.g. Filebeat) from syslog files.
- **Search / UI:** Kibana (or OpenSearch Dashboards): full-text search, filters, dashboards, visualizations.
- **AI:** No built-in log analysis by LLM; Elastic has ML features (anomaly detection, etc.) in commercial offerings.
- **Why it was not in the main recommendation:** Your requirement was **"comparably lightweight"** and Docker. ELK is **not lightweight**: Elasticsearch is Java-based; official guidance is that **< 8 GB RAM** is counterproductive for production; 16–64 GB is common. Logstash is also Java; the full stack has a large footprint compared to LogTide, VictoriaLogs, or Sloggo.
- **Verdict:** **Full-featured and proven**, but **heavy**. Use it if you need Elasticsearch-scale search and accept the resource cost; for a lightweight Docker setup, LogTide or VictoriaLogs fit better. OpenSearch is the fully open-source alternative if licensing matters.

---

## 3. AI / LLM for Log Analysis (Market)

- **No dominant open-source product** that does “syslog → store in PostgreSQL → search + built-in AI” in one box.
- Common approach: **separate AI step** — e.g. “analyze selected logs” or “explain this error” via:
  - **Paid API:** OpenAI, Anthropic, etc. (you send selected log text; cost per use).
  - **Self-hosted LLM:** Ollama, LlamaCPP, etc. (free, privacy-friendly, you run the model).
- **Log parsing/analysis research (2024):** e.g. LibreLog/OpenLogParser (LLM-based log parsing with open-source models); Logoscope, Loguru-CLI (CLI + AI). These are tools/libraries, not full syslog platforms with PostgreSQL storage.

**Conclusion:** AI part is typically added as an **optional feature** (API or local LLM) on top of whatever stores and searches logs. So “AI may be paid” is compatible with all options; we only need to pick where logs are stored and how they are searched.

---

## 4. Summary Matrix

| Solution              | Storage           | Lightweight? | Search UI? | Syslog? | Built-in AI? |
|-----------------------|-------------------|-------------|------------|---------|--------------|
| **LogTide**           | TimescaleDB (PG)  | Yes         | Yes        | Yes     | No           |
| **ELK / Elastic Stack** | Elasticsearch   | **No** (heavy) | Yes (Kibana) | Yes   | No           |
| Graylog               | MongoDB + ES/OS   | No          | Yes        | Yes     | No           |
| VictoriaLogs          | Own (optimized)   | Yes (best)  | Yes*       | Via agents | No        |
| Sloggo                | DuckDB            | Yes         | Yes        | Yes     | No           |
| rsyslog ompgsql       | PostgreSQL        | Yes         | No         | Yes     | No           |
| Custom                | Any (e.g. PG)     | Yes         | We build   | Yes     | We add (API) |

\* VictoriaLogs: Web UI + Grafana plugin; syslog via Vector/Fluent Bit.

---

## 5. Recommendation (any DB allowed)

### Option A: LogTide (recommended — ready-made)

- **Any DB** — use LogTide **as-is** with its included **TimescaleDB** container in Docker. One `docker compose up`; no need for your existing PostgreSQL.
- **You get:** Syslog (Fluent Bit on 514), store (TimescaleDB), search UI, SIEM, alerts. Redis optional (v0.5+ can use PostgreSQL for queue).
- **Add AI:** A small side service or UI action that sends selected logs to OpenAI / local LLM and shows the result.

### Option B: VictoriaLogs (lightest; own storage)

- **Maximum lightness:** Single binary, own storage. Use **Vector** or **Fluent Bit** to receive syslog and forward to VictoriaLogs. Search via built-in Web UI or Grafana.
- **Add AI:** Query logs, send selection to AI API or local LLM.

### Option C: Custom stack (e.g. PostgreSQL + rsyslog/Vector + backend + AI)

- Only if you want **full control** or a specific DB. We build: collector → DB → search API + optional UI + AI endpoint. Production-ready in this repo.

---

## 6. Next Steps

1. **Recommended:** **Option A (LogTide)** — deploy with bundled TimescaleDB, then add AI analysis (e.g. "Analyze" button or API).
2. **Lightest:** **Option B (VictoriaLogs + Vector + AI bridge)**.
3. **Custom:** **Option C** — we implement the full stack in this repo.

---

*Market study based on public documentation and source references (GitHub, official docs) as of 2026-02-06.*
