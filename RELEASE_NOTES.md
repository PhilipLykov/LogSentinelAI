# SyslogCollectorAI v0.7.1-beta — Bug Fixes & Hardening

**Patch release with important data integrity fixes, UI improvements, and security hardening.**

Upgrade from v0.7.0-beta is strongly recommended.

---

## What's New in v0.7.1

### Bug Fixes — Backend

- **Transactional Role Operations** — Role creation and permission updates are now wrapped in database transactions. Previously, a failure during permission insertion could leave a role with zero permissions.
- **Invalid Role Rejection** — Creating a user with a non-existent role now returns HTTP 400 instead of silently defaulting to `monitoring_agent`. Consistent with the update endpoint behavior.
- **Unknown Permission Rejection** — Assigning an invalid permission name to a role now returns HTTP 400 instead of silently dropping it.
- **Administrator Protection** — Cannot strip all permissions from the `administrator` system role via the API.
- **Cache TTL Fix** — The synchronous permission cache lookup now respects the 30-second TTL, preventing stale permissions from being served indefinitely.
- **Timestamp Consistency** — Migration 020 (roles table) now uses timezone-aware timestamps (`timestamptz`) matching all other tables.
- **Error Logging** — API key `last_used_at` update failures are now logged instead of silently swallowed.
- **Duplicate Type Cleanup** — `UserRole` type is now defined in a single canonical location.

### Bug Fixes — Frontend

- **Audit Log Export Dates** — The export function now correctly converts EU-format dates (`DD-MM-YYYY`) to ISO format before sending to the server. Previously, exports with date filters silently used unrecognized date strings.
- **Role Editor Dirty State** — Toggling permissions in the "Create Role" modal no longer falsely marks the main edit form as changed.
- **Role Editor Sync After Save** — The edit form now re-syncs from fresh server data after saving, ensuring any server-side normalization is reflected immediately.
- **User Management Fallback Roles** — If the roles API is unavailable, the role dropdown now shows built-in defaults instead of appearing empty.
- **NumericInput NaN Guard** — If a parent component passes `NaN`, the input displays `0` (or `min`) instead of literal "NaN" text.
- **Enable/Disable Button Styling** — The user Enable/Disable toggle now uses distinct CSS classes for each state.

---

## Deployment Options

### Option A — All-in-One (PostgreSQL included)

Everything runs inside Docker — no external database needed. Best for quick evaluation or small deployments.

```bash
git clone https://github.com/PhilipLykov/SyslogCollectorAI.git
cd SyslogCollectorAI/docker
cp .env.example .env
# Edit .env: set DB_PASSWORD (pick any strong password)
# Set DB_HOST=postgres

docker compose --profile db up -d --build
docker compose logs backend | grep -A 5 "BOOTSTRAP"
# Open http://localhost:8070
```

### Option B — External PostgreSQL (bring your own database)

Backend and dashboard run in Docker; you point them at your existing PostgreSQL server. Best for production environments.

```bash
git clone https://github.com/PhilipLykov/SyslogCollectorAI.git
cd SyslogCollectorAI/docker
cp .env.example .env
# Edit .env: set DB_HOST=<your-pg-server> and DB_PASSWORD

docker compose up -d --build
docker compose logs backend | grep -A 5 "BOOTSTRAP"
# Open http://localhost:8070
```

> AI model and API key are configured after login via **Settings > AI Model** in the web UI.

See [INSTALL.md](https://github.com/PhilipLykov/SyslogCollectorAI/blob/master/INSTALL.md) for the complete deployment guide.

## Upgrading from v0.7.0-beta

```bash
cd SyslogCollectorAI
git pull
cd docker
docker compose up -d --build
# Migrations run automatically on startup
```

---

**Full documentation**: [README.md](https://github.com/PhilipLykov/SyslogCollectorAI/blob/master/README.md) | [INSTALL.md](https://github.com/PhilipLykov/SyslogCollectorAI/blob/master/INSTALL.md)
