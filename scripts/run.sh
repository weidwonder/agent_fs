#!/usr/bin/env bash
set -euo pipefail

show_usage() {
  cat <<'EOF'
用法:
  ./scripts/run.sh -d

参数:
  -d    开发模式（等同于 pnpm --filter @agent-fs/electron-app dev）
  -h    显示帮助
EOF
}

dev_mode=false

while getopts ":dh" opt; do
  case "$opt" in
    d)
      dev_mode=true
      ;;
    h)
      show_usage
      exit 0
      ;;
    \?)
      echo "错误: 不支持的参数 -$OPTARG" >&2
      show_usage
      exit 1
      ;;
  esac
done

shift $((OPTIND - 1))

if [ "$#" -gt 0 ]; then
  echo "错误: 不支持的位置参数: $*" >&2
  show_usage
  exit 1
fi

if [ "$dev_mode" != "true" ]; then
  echo "错误: 目前仅支持 -d 开发模式" >&2
  show_usage
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "错误: 未找到 pnpm，请先安装 pnpm。" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec pnpm --filter @agent-fs/electron-app dev
