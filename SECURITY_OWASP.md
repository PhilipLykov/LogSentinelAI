# Security by Design — OWASP Top 10

**Requirement:** The solution must be **secure by design**. All design and implementation must follow **OWASP Top 10** (and applicable OWASP guidance). Security controls are built in from the design phase, not added afterward.

**Reference:** [OWASP Top 10:2021](https://owasp.org/Top10/2021/). Where relevant, align with [OWASP Top 10:2025](https://owasp.org/Top10/2025/) as it stabilizes.

**Context:** PROJECT_INSTRUCTIONS.md (Instruction 11), AI_ANALYSIS_SPEC.md, FEATURES_AND_INTEGRATIONS.md.

---

## 1. OWASP Top 10:2021 — Mapping to Our Product

For each category, we state how the **product design and implementation** must address it. Apply these in architecture, APIs, connectors, dashboard, and deployment.

---

### A01 — Broken Access Control

- **Risk:** Users or processes access data or actions outside intended permissions.
- **Our product:** API (ingest, query, scores, config), dashboard, connector configs, notification configs (webhooks, Pushover, Telegram), stored logs and scores.
- **Requirements:**
  - **Authentication:** All sensitive endpoints (query, config, dashboard, management) require authentication. Ingest endpoints may use API keys or mutually authenticated channels; keys are scoped (e.g. per project/system) and revocable.
  - **Authorization:** Role- or scope-based access: e.g. read-only vs admin; per-organization/per-project isolation where multi-tenant. Enforce at API and UI; never rely on client to hide actions.
  - **IDs and references:** Use non-guessable IDs (UUIDs) for resources; validate that the authenticated principal is allowed to access the requested resource (e.g. system_id, window_id).
  - **Rate limiting:** Per key/user to prevent abuse; apply to ingest and query APIs.
  - **CORS and deployment:** Restrict origins and methods for web dashboard; document safe deployment (e.g. reverse proxy, no sensitive API exposed to internet without auth).

---

### A02 — Cryptographic Failures

- **Risk:** Sensitive data exposed or tampered due to weak or missing crypto.
- **Our product:** Log data (often sensitive), credentials (DB, API keys, LLM keys, Pushover/Telegram tokens), data in transit and at rest.
- **Requirements:**
  - **Transit:** TLS for all external and internal APIs and dashboard (HTTPS). Enforce TLS for connector calls to external systems (e.g. Elasticsearch, Telegram).
  - **At rest:** Encrypt sensitive data at rest (DB, file storage). Store secrets (API keys, tokens, DB passwords) in a secrets manager or encrypted config; never in plain text in code or logs.
  - **Hashing:** Use strong, salted hashes for any stored passwords; prefer modern algorithms (e.g. Argon2, bcrypt).
  - **Sensitive log content:** Consider field-level redaction or encryption for PII/secrets in stored logs if required by policy; document what is stored and where.

---

### A03 — Injection

- **Risk:** Untrusted input executed as code or used in queries (SQL, OS, template, LLM prompt).
- **Our product:** Ingest payloads, connector configs (queries, URLs), RAG/NL query input, system descriptions, LLM prompts (partially user-controlled).
- **Requirements:**
  - **API and DB:** Parameterized queries / prepared statements only; no concatenation of user input into SQL or NoSQL. Use ORM/query builder correctly.
  - **Connectors:** Validate and sanitize URLs, query templates, and file paths from config; allowlist schemes and hosts where applicable (e.g. SSRF prevention for pull connectors).
  - **LLM and RAG:** Treat user input (NL query, system description) as untrusted in prompts; sanitize or encode to avoid prompt injection and data exfiltration. Limit scope of RAG retrieval by authorization.
  - **Log content:** When building prompts from log data, guard against injection of control characters or prompt-breaking sequences; use structured fields and safe encoding.
  - **OS/commands:** Avoid shell or OS execution with user input; if needed, use strict allowlists and no user-controlled arguments.

---

### A04 — Insecure Design

- **Risk:** Flaws in design or architecture that cannot be fixed by implementation alone.
- **Our product:** Architecture (ingest → process → store → notify), trust boundaries, data flow.
- **Requirements:**
  - **Threat model:** Document trust boundaries (e.g. ingest API, external connectors, LLM provider, dashboard users). Identify and mitigate threats (e.g. malicious log injection, credential theft, abuse of LLM or connectors).
  - **Least privilege:** Services and connectors run with minimal permissions; DB and API use dedicated credentials with least required access.
  - **Secure defaults:** Default config is locked down (auth required, TLS, no default admin password). Optional features (e.g. public ingest) are opt-in and documented.
  - **Integrity:** Ensure pipeline integrity (e.g. tamper-evident or authenticated logging of critical actions); verify integrity of dependencies and config where applicable (see A08).

---

### A05 — Security Misconfiguration

- **Risk:** Defaults, incomplete hardening, or open services lead to exposure.
- **Our product:** Web server, API, dashboard, DB, Docker/deployment, connector configs.
- **Requirements:**
  - **Hardening:** Secure headers (CSP, HSTS, X-Frame-Options, etc.) for dashboard; disable unnecessary endpoints and debug in production.
  - **Config:** No default secrets; require explicit setting of secrets (env or secrets manager). Document all security-relevant config options.
  - **Containers:** Use minimal base images; run as non-root where possible; document secure Docker/deployment (e.g. read-only filesystem, no privileged).
  - **Inventory:** Maintain list of components and configs; review periodically for misconfiguration.

---

### A06 — Vulnerable and Outdated Components

- **Risk:** Known vulnerabilities in libraries, frameworks, or runtime.
- **Our product:** Application stack, SDKs (DB, HTTP, LLM, Telegram, etc.), base images.
- **Requirements:**
  - **Dependencies:** Track dependencies (e.g. lockfiles, SBOM); regularly update and patch. Use automated dependency scanning (e.g. Dependabot, Snyk, OWASP Dependency-Check) in CI.
  - **Vulnerability response:** Define process to assess and remediate CVEs; prioritize critical/high for the deployment context.
  - **Base images:** Pin and update base images; prefer minimal and maintained tags.

---

### A07 — Identification and Authentication Failures

- **Risk:** Weak or bypassed authentication, session fixation, credential stuffing.
- **Our product:** Dashboard login, API keys for ingest/query, optional integration with IdP.
- **Requirements:**
  - **API keys:** Strong, unguessable keys (e.g. cryptographically random); stored hashed or in secure storage; scoped and revocable. Transmit only in headers or secure channel.
  - **Sessions:** Secure session management (httpOnly, secure cookies; or token-based with short expiry and refresh). Invalidate on logout and password change.
  - **Auth failures:** Do not reveal whether user or key exists; rate limit and optionally lock after repeated failures; log auth events for monitoring (see A09).
  - **Password policy:** If the product manages passwords, enforce strength and no default passwords.

---

### A08 — Software and Data Integrity Failures

- **Risk:** Unsigned or tampered code, config, or data; insecure CI/CD or supply chain.
- **Our product:** Application code, config, connector definitions, data from external systems (logs, LLM responses).
- **Requirements:**
  - **Integrity of code and images:** Sign artifacts and base images where feasible; verify in deployment pipeline.
  - **Config and secrets:** Protect config from tampering; use integrity checks or signed config for critical settings if needed.
  - **External data:** Validate and sanitize data from connectors and LLM; do not trust LLM output for security decisions without validation. Log integrity or checksums for critical data flows where useful for audit.
  - **Supply chain:** Prefer well-maintained dependencies; verify provenance when possible; document how third-party services (LLM, Pushover, Telegram) are used and what data is sent.

---

### A09 — Security Logging and Monitoring Failures

- **Risk:** Missing or inadequate logging and monitoring for security events; no response to incidents.
- **Our product:** We are a log analysis product; our own security logging and monitoring must be exemplary.
- **Requirements:**
  - **Security events:** Log authentication (success/failure), authorization failures, config changes, admin actions, and API errors (with care not to log secrets). Use structured logging with timestamps (e.g. Europe/Chisinau per user rule).
  - **Monitoring and alerting:** Integrate our own product or external SIEM/monitoring to alert on security-relevant patterns (e.g. auth failures, unusual access, config change).
  - **Retention and protection:** Define retention for security logs; protect log storage from unauthorized modification or deletion.
  - **No sensitive data in logs:** Avoid logging full API keys, passwords, or PII; redact or hash where necessary.

---

### A10 — Server-Side Request Forgery (SSRF)

- **Risk:** Attacker induces the server to send requests to unintended or internal resources.
- **Our product:** Connectors that pull from URLs (Elasticsearch, LogTide, Loki, webhooks), outbound calls to LLM, Pushover, Telegram, webhooks.
- **Requirements:**
  - **Connector URLs and config:** Validate and allowlist URL schemes and hosts for pull connectors; block private/internal IP ranges and localhost unless explicitly allowed (e.g. dedicated config). Use URL parsers and reject malformed URLs.
  - **Webhooks and notifications:** Validate outbound URLs (allowlist schemes; optional allowlist of hostnames). Do not send requests to user-controlled URLs that could target internal services unless designed for it (and then restrict).
  - **LLM and external APIs:** Use fixed, well-known endpoints for LLM and notification providers; no user-controlled URLs for those calls.
  - **Error handling:** Do not leak internal network or response details to the client in error messages (see also exceptional condition handling).

---

## 2. Secure by Design — Summary

- **Design phase:** Apply OWASP Top 10 in architecture and design (access control, crypto, injection prevention, SSRF prevention, integrity, logging). Review and update this document when adding features (connectors, APIs, integrations).
- **Implementation:** Use secure coding practices; parameterized queries; safe handling of secrets and input; dependency and image hygiene.
- **Deployment:** Document secure deployment (TLS, auth, hardening, secrets management) and recommend security logging and monitoring.

---

## 3. References

- [OWASP Top 10:2021](https://owasp.org/Top10/2021/)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) (as it evolves)
- PROJECT_INSTRUCTIONS.md (Instruction 11)
- User rule: timestamp in logs in Europe/Chisinau; OWASP Top 10 always followed
