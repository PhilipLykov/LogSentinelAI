#!/bin/sh
set -e

# Fix ownership of bind-mounted data directories.
# When a host directory is mounted into the container (e.g. ./backups:/app/data/backups),
# the host ownership overrides the Dockerfile's chown. This entrypoint ensures
# the appuser can write to these directories at startup, then drops privileges.

if [ "$(id -u)" = '0' ]; then
  # Ensure data directories are writable by appuser
  chown -R appuser:appgroup /app/data 2>/dev/null || true
  # Drop to non-root user (OWASP A05) and exec the main command
  exec su-exec appuser "$@"
fi

# If already running as non-root, just exec
exec "$@"
