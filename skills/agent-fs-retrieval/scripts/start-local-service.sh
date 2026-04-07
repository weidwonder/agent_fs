#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-${AGENT_FS_LOCAL_HOST:-127.0.0.1}}"
PORT="${2:-${AGENT_FS_LOCAL_PORT:-3001}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [[ -n "${AGENT_FS_LOCAL_START_CMD:-}" ]]; then
  exec /bin/sh -lc "$AGENT_FS_LOCAL_START_CMD"
fi

if [[ -n "${AGENT_FS_LOCAL_BIN:-}" ]]; then
  exec "${AGENT_FS_LOCAL_BIN}" serve --host="$HOST" --port="$PORT"
fi

if command -v agent-fs-mcp >/dev/null 2>&1; then
  exec agent-fs-mcp serve --host="$HOST" --port="$PORT"
fi

if command -v agent-fs >/dev/null 2>&1; then
  exec agent-fs serve --host="$HOST" --port="$PORT"
fi

if [[ -f "${ROOT}/pnpm-workspace.yaml" ]]; then
  cd "$ROOT"
  pnpm --filter @agent-fs/mcp-server build
  exec pnpm --filter @agent-fs/mcp-server start --host="$HOST" --port="$PORT"
fi

echo "未找到可用的本地 Agent FS 运行时。请先阅读 setup.md 完成本地运行时配置。" >&2
exit 1
