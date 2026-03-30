#!/usr/bin/env sh
# docker/init-db.sh
# Waits for PostgreSQL to be ready, then runs the migration SQL.
# Usage: DATABASE_URL=postgresql://user:pass@host:5432/db ./init-db.sh

set -e

# Parse connection info from DATABASE_URL
# Expected format: postgresql://user:pass@host:port/dbname
DB_URL="${DATABASE_URL:-postgresql://agentfs:changeme@localhost:5432/agentfs}"

PG_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
PG_PORT=$(echo "$DB_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
PG_USER=$(echo "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
PG_DB=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')

MIGRATION_FILE="${MIGRATION_FILE:-packages/storage-cloud/migrations/001-init-schema.sql}"

echo "Waiting for PostgreSQL at $PG_HOST:$PG_PORT..."
until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -q; do
  sleep 1
done

echo "Running migration: $MIGRATION_FILE"
PGPASSWORD=$(echo "$DB_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|') \
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -f "$MIGRATION_FILE"

echo "Migration complete."
