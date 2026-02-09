# Installation Guide

This guide walks you through installing SyslogCollectorAI from start to finish. Choose the deployment method that fits your environment.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Docker Deployment (Recommended)](#2-docker-deployment-recommended)
3. [Standalone Deployment (Without Docker)](#3-standalone-deployment-without-docker)
4. [First Login](#4-first-login)
5. [Configuring Your First Monitored System](#5-configuring-your-first-monitored-system)
6. [Connecting Log Sources](#6-connecting-log-sources)
7. [Syslog Forwarder Setup (rsyslog)](#7-syslog-forwarder-setup-rsyslog)
8. [Log Shipper Integration](#8-log-shipper-integration)
9. [LLM Configuration](#9-llm-configuration)
10. [Alerting Setup](#10-alerting-setup)
11. [Backup & Maintenance](#11-backup--maintenance)
12. [Upgrading](#12-upgrading)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

### Required

| Component | Minimum Version | Notes |
|-----------|----------------|-------|
| **PostgreSQL** | 14+ | Can be on same or separate server |
| **OpenAI-compatible API** | Any | OpenAI, Azure OpenAI, Ollama, LM Studio, etc. |

### For Docker deployment

| Component | Minimum Version |
|-----------|----------------|
| **Docker** | 20.10+ |
| **Docker Compose** | 2.0+ (V2 plugin) |

### For standalone deployment

| Component | Minimum Version |
|-----------|----------------|
| **Node.js** | 20+ (22 recommended) |
| **npm** | 9+ |

### Network Requirements

| Port | Service | Direction |
|------|---------|-----------|
| `3000` | Backend API | Inbound from dashboard and log shippers |
| `8070` | Dashboard UI | Inbound from user browsers |
| `5432` | PostgreSQL | Backend to database |
| `443` | OpenAI API | Outbound from backend to LLM provider |

---

## 2. Docker Deployment (Recommended)

This is the simplest way to get started. You need Docker and an external PostgreSQL database.

### Step 1: Clone the repository

```bash
git clone https://github.com/PhilipLykov/SyslogCollectorAI.git
cd SyslogCollectorAI
```

### Step 2: Create the PostgreSQL database

Connect to your PostgreSQL server and run:

```sql
CREATE DATABASE syslog_collector_ai;
CREATE USER syslog_ai WITH PASSWORD 'your_strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE syslog_collector_ai TO syslog_ai;

-- Connect to the new database
\c syslog_collector_ai

-- Grant schema permissions (required for migrations)
GRANT CREATE ON SCHEMA public TO syslog_ai;
```

### Step 3: Configure environment

```bash
cd docker
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# ── Database ──────────────────────────────────────────────────
DB_HOST=192.168.1.100          # Your PostgreSQL server IP
DB_PORT=5432
DB_NAME=syslog_collector_ai
DB_USER=syslog_ai
DB_PASSWORD=your_strong_password_here

# ── LLM ──────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...          # Your OpenAI API key
OPENAI_MODEL=gpt-4o-mini       # Recommended for cost-efficiency

# ── Dashboard URL (how your browser reaches the backend) ─────
VITE_API_URL=http://192.168.1.100:3000
DASHBOARD_PORT=8070

# ── CORS (set to your dashboard URL) ─────────────────────────
CORS_ORIGIN=http://192.168.1.100:8070

# ── Optional: Bootstrap admin credentials ─────────────────────
# If not set, a random password is generated and printed to logs
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=YourSecureAdminPassword123!
```

> **Important**: Replace `192.168.1.100` with the actual IP address or hostname of your server as accessible from your browser.

### Step 4: Build and start

```bash
docker compose build
docker compose up -d
```

### Step 5: Verify startup

```bash
# Check both containers are running
docker compose ps

# Check backend logs for successful startup and admin credentials
docker logs docker-backend-1 2>&1 | grep -A 5 "BOOTSTRAP"
```

You should see output like:

```
┌──────────────────────────────────────────────────────────┐
│  BOOTSTRAP ADMIN ACCOUNT (save these credentials!):      │
│  Username: admin                                         │
│  Password: xK7mN2pQ9wR4tY6u!A1a                         │
└──────────────────────────────────────────────────────────┘
```

**Save these credentials.** You will need them to log in.

### Step 6: Access the dashboard

Open `http://your-server:8070` in your browser and proceed to [First Login](#4-first-login).

---

## 3. Standalone Deployment (Without Docker)

Use this method if you prefer to run Node.js directly on your server.

### Step 1: Clone and install dependencies

```bash
git clone https://github.com/PhilipLykov/SyslogCollectorAI.git
cd SyslogCollectorAI

# Install backend dependencies
cd backend
npm install

# Install dashboard dependencies
cd ../dashboard
npm install
cd ..
```

### Step 2: Create the PostgreSQL database

Same as [Docker Step 2](#step-2-create-the-postgresql-database) above.

### Step 3: Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:

```bash
HOST=0.0.0.0
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=syslog_collector_ai
DB_USER=syslog_ai
DB_PASSWORD=your_strong_password_here

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

REDACTION_ENABLED=false
TZ=Europe/Chisinau

# Optional: set admin credentials
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=YourSecureAdminPassword123!
```

### Step 4: Start the backend

```bash
cd backend
npm run build
npm start
```

On first start, the backend will:
1. Run all database migrations automatically
2. Seed the 6 analysis criteria
3. Create the admin user (credentials printed to console)

### Step 5: Build and serve the dashboard

```bash
cd dashboard

# Set the backend URL (adjust to your server)
export VITE_API_URL=http://localhost:3000

# Build the static files
npm run build

# Serve with any static file server, for example:
npx serve -s dist -l 8070
```

For production, use nginx or a similar web server to serve the `dashboard/dist` folder. Example nginx config:

```nginx
server {
    listen 8070;
    root /path/to/SyslogCollectorAI/dashboard/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Step 6: Access the dashboard

Open `http://your-server:8070` in your browser.

---

## 4. First Login

1. Open the dashboard URL in your browser (`http://your-server:8070`).
2. You will see a login form with username and password fields.
3. Enter the admin credentials from the startup logs (see Step 5 of your deployment method).
4. If the password was auto-generated, you will be immediately prompted to set a new password.
   - The new password must be at least **12 characters** with uppercase, lowercase, digit, and special character.
5. After login, you will see the main dashboard.

> **Can't find the password?** Run `docker logs docker-backend-1 2>&1 | grep -A 5 "BOOTSTRAP"` to see it again. If the logs have been rotated, you can reset by deleting all users from the database and restarting the backend:
> ```bash
> docker exec -it docker-postgres-1 psql -U syslog_ai -d syslog_collector_ai \
>   -c "DELETE FROM sessions; DELETE FROM users;"
> docker restart docker-backend-1
> ```

---

## 5. Configuring Your First Monitored System

After logging in, go to **Settings > Systems & Sources**.

### Create a system

1. Click **+ Add** in the left panel.
2. Enter a name (e.g., `Production Server`) and optional description.
3. Optionally set a data retention period (e.g., 90 days). Leave empty for the global default.
4. Click **Save**.

### Add a log source

Log sources define rules for matching incoming events to your system using regex patterns on event fields.

1. Select your new system in the left panel.
2. Click **+ Add Source**.
3. Set a label (e.g., `All events from 192.168.1.x`).
4. Define the selector — a set of field-matching rules:
   - `{"source_ip": "^192\\.168\\.1\\."}` — matches events from the 192.168.1.x subnet
   - `{"host": "^prod-server"}` — matches events from hosts starting with "prod-server"
   - `{"host": ".*"}` — catch-all: matches everything
5. Set priority (lower number = evaluated first). Use low priorities for specific rules and higher (e.g., 100) for catch-all rules.
6. Click **Save**.

> **Tip**: Expand the "How selectors work" section on the settings page for more examples and explanation.

---

## 6. Connecting Log Sources

Before events can appear in the dashboard, you need to send them to the ingest API.

### Create an API key for ingestion

1. Go to **Settings > API Keys**.
2. Click **+ Create API Key**.
3. Set a name (e.g., `syslog-forwarder`), scope to **ingest**, and click **Create**.
4. **Copy the displayed key immediately** — it will not be shown again.

### Test ingestion

Send a test event using curl:

```bash
curl -X POST http://your-server:3000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_INGEST_KEY" \
  -d '{"events": [{"message": "Test event from curl", "host": "test-host", "severity": "info"}]}'
```

If configured correctly, you should see the event appear in the Event Explorer within seconds.

---

## 7. Syslog Forwarder Setup (rsyslog)

This section explains how to forward local syslog events from a Linux server to SyslogCollectorAI.

### Step 1: Configure rsyslog to write JSON

Create `/etc/rsyslog.d/60-syslogcollector.conf`:

```
template(name="SyslogAiJson" type="list") {
    constant(value="{\"timestamp\":\"")
    property(name="timereported" dateFormat="rfc3339")
    constant(value="\",\"message\":\"")
    property(name="msg" format="jsonr" droplastlf="on")
    constant(value="\",\"host\":\"")
    property(name="hostname" format="jsonr")
    constant(value="\",\"source_ip\":\"")
    property(name="fromhost-ip")
    constant(value="\",\"severity\":\"")
    property(name="syslogseverity-text")
    constant(value="\",\"facility\":\"")
    property(name="syslogfacility-text")
    constant(value="\",\"program\":\"")
    property(name="programname" format="jsonr")
    constant(value="\"}\n")
}

if $programname != 'syslog-forwarder.py' then {
    action(type="omfile" file="/var/log/syslog-ai.jsonl" template="SyslogAiJson")
}
```

Restart rsyslog:

```bash
sudo systemctl restart rsyslog
```

### Step 2: Create the forwarder script

Create `/opt/syslog-forwarder/syslog-forwarder.py`:

```python
#!/usr/bin/env python3
"""Forward JSON syslog lines to SyslogCollectorAI ingest API."""

import json, time, os, sys, urllib.request, urllib.error
from datetime import datetime

JSONL_PATH = os.environ.get("JSONL_PATH", "/var/log/syslog-ai.jsonl")
API_URL    = os.environ.get("API_URL", "http://localhost:3000/api/v1/ingest")
API_KEY    = os.environ.get("API_KEY", "")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "500"))
POLL_SEC   = int(os.environ.get("POLL_SEC", "5"))

def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def send_batch(events):
    data = json.dumps({"events": events}).encode()
    req = urllib.request.Request(API_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-API-Key", API_KEY)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            log(f"POST OK ({len(events)} events): {resp.status}")
    except urllib.error.HTTPError as e:
        log(f"POST failed ({len(events)} events): {e}")
    except Exception as e:
        log(f"POST error: {e}")

def main():
    if not API_KEY:
        log("ERROR: API_KEY not set"); sys.exit(1)
    log(f"Starting: file={JSONL_PATH} api={API_URL} batch={BATCH_SIZE}")

    # Start from end of file
    try:
        pos = os.path.getsize(JSONL_PATH)
    except FileNotFoundError:
        pos = 0

    while True:
        try:
            with open(JSONL_PATH, "r") as f:
                f.seek(pos)
                batch = []
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        batch.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
                    if len(batch) >= BATCH_SIZE:
                        send_batch(batch)
                        batch = []
                if batch:
                    send_batch(batch)
                pos = f.tell()
        except FileNotFoundError:
            pass
        except Exception as e:
            log(f"Read error: {e}")
        time.sleep(POLL_SEC)

if __name__ == "__main__":
    main()
```

Make it executable:

```bash
chmod +x /opt/syslog-forwarder/syslog-forwarder.py
```

### Step 3: Create a systemd service

Create `/etc/systemd/system/syslog-forwarder.service`:

```ini
[Unit]
Description=Syslog Forwarder to SyslogCollectorAI
After=network.target rsyslog.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/syslog-forwarder/syslog-forwarder.py
Environment=JSONL_PATH=/var/log/syslog-ai.jsonl
Environment=API_URL=http://your-server:3000/api/v1/ingest
Environment=API_KEY=YOUR_INGEST_API_KEY
Environment=BATCH_SIZE=500
Environment=POLL_SEC=5
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now syslog-forwarder
sudo systemctl status syslog-forwarder
```

Check logs:

```bash
journalctl -u syslog-forwarder --no-pager -n 20
```

---

## 8. Log Shipper Integration

The ingest API accepts three JSON formats:
- `{ "events": [...] }` — batch format (recommended)
- `[{...}, {...}]` — bare JSON array
- `{ "message": "...", ... }` — single event object

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

### Accepted Event Fields

| Field | Required | Description |
|-------|----------|-------------|
| `message` / `msg` / `short_message` | **Yes** | Log message content |
| `timestamp` / `time` / `@timestamp` | No | ISO 8601 or Unix epoch (auto-detected) |
| `severity` / `level` | No | Syslog severity name or number (0-7) |
| `host` / `hostname` / `source` | No | Originating hostname |
| `source_ip` / `fromhost_ip` / `ip` | No | Source IP address |
| `service` / `service_name` | No | Service/application name |
| `program` / `app_name` | No | Program name |
| `facility` | No | Syslog facility |
| `trace_id` / `traceId` | No | Distributed trace ID |
| `span_id` / `spanId` | No | Span ID |

Unknown fields are preserved in a `raw` JSON column for reference.

---

## 9. LLM Configuration

After login, go to **Settings > AI Model** to configure:

- **Model**: Select the LLM model (e.g., `gpt-4o-mini` for cost-efficiency, `gpt-4o` for higher quality)
- **API Key**: Configured via the `OPENAI_API_KEY` environment variable
- **API Base URL**: For non-OpenAI providers (Ollama, LM Studio, Azure), set the base URL
- **Temperature**: Controls response randomness (0.0 = deterministic, 1.0 = creative). Recommended: 0.1-0.3
- **System Prompts**: Edit the scoring, meta-analysis, and RAG prompts
- **Per-Criterion Prompts**: Fine-tune each of the 6 scoring criteria independently
- **Token Optimization**: Enable score caching, severity filtering, message truncation, and batch sizing

The AI pipeline runs automatically every 5 minutes (configurable via `PIPELINE_INTERVAL_MS` environment variable).

---

## 10. Alerting Setup

Go to **Settings > Notifications** to configure alerting.

### Step 1: Create a notification channel

Supported channels: **Webhook**, **Pushover**, **NTfy**, **Gotify**, **Telegram**.

For each channel, provide the required configuration. Secrets should be referenced as environment variables using the `env:VAR_NAME` format.

Example for Telegram:
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your `.env` file
- In the channel config, use `env:TELEGRAM_BOT_TOKEN` as the token reference

Click **Test** to verify the channel works.

### Step 2: Create alert rules

Define rules that trigger notifications when scores exceed thresholds:
- Select which criteria to monitor
- Set score thresholds (e.g., alert when IT Security > 50%)
- Choose notification channels
- Configure throttle interval (prevent alert storms)
- Enable recovery alerts (notify when scores drop back below threshold)

### Step 3: Manage silences

Create silence windows to temporarily suppress notifications during maintenance.

---

## 11. Backup & Maintenance

### Database Backup

Go to **Settings > Database** and expand the **Backup Configuration** section:

- **Schedule**: Set how often backups run (e.g., daily)
- **Format**: Choose between custom binary (smaller, faster restore) or plain SQL (human-readable)
- **Retention**: How many backup files to keep
- **Manual Trigger**: Run a backup immediately
- **Download**: Download any backup file directly from the UI

Backup files are stored in the `./docker/backups/` directory (Docker) or `/app/data/backups/` (standalone).

### Data Retention

Configure automatic cleanup of old events:

- **Global retention**: Set a default retention period for all systems
- **Per-system retention**: Override for individual systems (e.g., 30 days for debug logs, 365 days for security events)
- **Maintenance schedule**: Automatic VACUUM ANALYZE and REINDEX for database health

### Session Cleanup

Expired user sessions are automatically cleaned up by the maintenance job.

---

## 12. Upgrading

### Docker

```bash
cd SyslogCollectorAI
git pull
cd docker
docker compose build
docker compose up -d
```

Database migrations run automatically on startup — no manual steps needed.

### Standalone

```bash
cd SyslogCollectorAI
git pull

cd backend
npm install
npm run build
# Restart the backend process

cd ../dashboard
npm install
VITE_API_URL=http://your-server:3000 npm run build
# Restart the dashboard web server
```

---

## 13. Troubleshooting

### Events not appearing in the dashboard

1. **Check log source selectors**: Go to Settings > Systems & Sources. Make sure the selector fields match your incoming events. For example, if events have `source_ip: "127.0.0.1"`, the selector must match that: `{"source_ip": "127.0.0.1"}` or `{"source_ip": ".*"}`.

2. **Check the forwarder logs**:
   ```bash
   journalctl -u syslog-forwarder --no-pager -n 20
   ```
   Look for `HTTP Error 400` or `HTTP Error 401`.

3. **Test ingestion manually**:
   ```bash
   curl -X POST http://your-server:3000/api/v1/ingest \
     -H "Content-Type: application/json" \
     -H "X-API-Key: YOUR_KEY" \
     -d '[{"message": "test", "host": "test", "source_ip": "127.0.0.1"}]'
   ```

### Cannot log in

- If you forgot the admin password, reset it by deleting users from the database (see [First Login](#4-first-login)).
- Check that the backend is running: `docker compose ps` or check the process.
- Verify the dashboard can reach the backend: the `VITE_API_URL` must be accessible from your browser.

### Backend fails to start

- Check database connectivity: ensure PostgreSQL is running and accessible from the backend container/host.
- Check logs: `docker logs docker-backend-1` or check stdout.
- Verify environment variables are set correctly in `.env`.

### High LLM costs

- Go to Settings > AI Model > Token Optimization.
- Enable **Score caching** (reuses scores for similar messages).
- Enable **Severity pre-filtering** to skip scoring debug/info events.
- Reduce **Scoring batch size** to limit tokens per request.
- Switch to a cheaper model like `gpt-4o-mini`.

### Backup fails with "Permission denied"

The backup directory needs write permissions for the backend process:
- Docker: ensure `./docker/backups/` directory exists and is writable. The entrypoint script handles this automatically.
- Standalone: ensure `/app/data/backups/` is writable by the Node.js process.

---

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_HOST` | Yes | - | PostgreSQL hostname |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | Yes | - | Database name |
| `DB_USER` | Yes | - | Database username |
| `DB_PASSWORD` | Yes | - | Database password |
| `OPENAI_API_KEY` | Yes | - | OpenAI (or compatible) API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | LLM model name |
| `PORT` | No | `3000` | Backend listen port |
| `HOST` | No | `0.0.0.0` | Backend bind address |
| `DASHBOARD_PORT` | No | `8070` | Dashboard listen port (Docker) |
| `VITE_API_URL` | Yes | - | Backend URL as seen by browser |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `ADMIN_USERNAME` | No | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | No | *(generated)* | Initial admin password (min 12 chars) |
| `REDACTION_ENABLED` | No | `false` | Enable secret redaction before storage |
| `PIPELINE_INTERVAL_MS` | No | `300000` | AI pipeline run interval (ms) |
| `TZ` | No | `UTC` | Timezone for logs |
