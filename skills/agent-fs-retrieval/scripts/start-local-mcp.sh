#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-127.0.0.1}"
PORT="${2:-3001}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

cd "$ROOT"
pnpm --filter @agent-fs/mcp-server build
pnpm --filter @agent-fs/mcp-server start --host="$HOST" --port="$PORT"
