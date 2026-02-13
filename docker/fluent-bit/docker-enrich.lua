-- ─────────────────────────────────────────────────────────────────────
--  LogSentinel AI — Docker Container Log Enrichment (Fluent Bit Lua)
-- ─────────────────────────────────────────────────────────────────────
--
--  This script runs as a Fluent Bit Lua filter on records tagged
--  "docker.*" (from the tail input reading Docker json-file logs).
--
--  What it does:
--    1. Extracts the container ID from the log file path
--    2. Reads Docker's config.v2.json to resolve the container name
--    3. Caches the name (one file read per container, ever)
--    4. Sets "program" to the container name
--    5. Maps stream=stderr → severity=error
--    6. Drops Fluent Bit / log-collector's own logs (prevents loop)
--    7. Cleans up internal fields (log_path, stream)
--
--  Requirements:
--    - /var/lib/docker/containers must be mounted into the Fluent Bit
--      container (read-only is fine)
--    - Path_Key must be set to "log_path" on the tail input
-- ─────────────────────────────────────────────────────────────────────

-- Cache: container_id → container_name (populated lazily, never evicted)
local name_cache = {}

-- Patterns in the container name that identify the log-collector itself.
-- Events from these containers are dropped to avoid a feedback loop.
local SELF_PATTERNS = { "log%-collector", "fluent%-bit", "fluent_bit", "fluentbit" }

function enrich_docker(tag, timestamp, record)
    local log_path = record["log_path"]
    if not log_path then
        return 0, timestamp, record  -- no path → pass through unchanged
    end

    -- Extract 64-hex-char container ID from the Docker log path:
    -- /var/lib/docker/containers/<id>/<id>-json.log
    local container_id = log_path:match("/containers/(%x+)/")
    if not container_id then
        -- Not a Docker log path — clean up and pass through
        record["log_path"] = nil
        return 1, timestamp, record
    end

    -- ── Resolve container name (with cache) ─────────────────────
    if not name_cache[container_id] then
        local resolved = container_id:sub(1, 12)  -- fallback: short ID

        local config_path = "/var/lib/docker/containers/"
                          .. container_id .. "/config.v2.json"
        local f = io.open(config_path, "r")
        if f then
            local content = f:read("*a")
            f:close()
            -- Docker stores the container name as: "Name":"/compose-service-1"
            -- The leading "/" is stripped by the optional /? in the pattern.
            local name = content:match('"Name":"/?([^"]+)"')
            if name and #name > 0 then
                resolved = name
            end
        end

        name_cache[container_id] = resolved
    end

    local container_name = name_cache[container_id]

    -- ── Drop self-logs (Fluent Bit / log-collector) ─────────────
    local lower_name = container_name:lower()
    for _, pat in ipairs(SELF_PATTERNS) do
        if lower_name:match(pat) then
            return -1, timestamp, record  -- drop record
        end
    end

    -- ── Enrich fields ───────────────────────────────────────────
    record["program"] = container_name

    -- Map stderr → error severity hint (stdout left as-is for
    -- the backend's content-based severity enrichment to handle)
    if record["stream"] == "stderr" then
        record["severity"] = "error"
    end

    -- Clean up internal fields — not needed in the backend
    record["log_path"] = nil
    record["stream"] = nil

    return 1, timestamp, record
end
