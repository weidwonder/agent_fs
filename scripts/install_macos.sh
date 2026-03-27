#!/usr/bin/env bash
# Agent FS macOS 本地安装脚本
# 用法: ./scripts/install_macos.sh [--skip-build|-s]
#
# 构建当前 Electron 应用为 .app 并安装到 /Applications
# --skip-build: 跳过构建与打包，直接安装已有产物

set -euo pipefail

show_usage() {
  cat <<'EOF'
用法:
  ./scripts/install_macos.sh [--skip-build|-s] [--help|-h]

参数:
  -s, --skip-build    跳过构建与打包，直接安装已有 .app 产物
  -h, --help          显示帮助
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Agent FS"
ELECTRON_APP_DIR="$ROOT_DIR/packages/electron-app"
DIST_DIR="$ELECTRON_APP_DIR/dist"
INSTALL_DIR="/Applications"
TARGET_APP_PATH="$INSTALL_DIR/${APP_NAME}.app"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      echo -e "${RED}错误:${NC} 不支持的参数: $1" >&2
      show_usage
      exit 1
      ;;
  esac
done

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo -e "${RED}错误:${NC} 当前脚本仅支持 macOS" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${RED}错误:${NC} 未找到 pnpm，请先安装 pnpm" >&2
  exit 1
fi

cd "$ROOT_DIR"

find_built_app() {
  local found_app
  found_app="$(find "$DIST_DIR" -maxdepth 2 -type d -name "${APP_NAME}.app" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$found_app" ]]; then
    printf '%s\n' "$found_app"
  fi
}

run_install_command() {
  if [[ -w "$INSTALL_DIR" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

if [[ "$SKIP_BUILD" == false ]]; then
  echo ""
  echo -e "${BLUE}[clean]${NC} 清理旧的 Electron 打包产物..."
  rm -rf \
    "$DIST_DIR/mac" \
    "$DIST_DIR/mac-arm64" \
    "$DIST_DIR/mac-universal" \
    "$DIST_DIR/builder-debug.yml" \
    "$DIST_DIR/builder-effective-config.yaml"
  find "$DIST_DIR" -maxdepth 1 \( -name "*.dmg" -o -name "*.zip" -o -name "*.blockmap" \) -delete 2>/dev/null || true

  echo ""
  echo -e "${BLUE}[build]${NC} 构建 Electron 应用..."
  pnpm --filter @agent-fs/electron-app build

  echo ""
  echo -e "${BLUE}[package]${NC} 打包 macOS .app 产物..."
  pnpm --filter @agent-fs/electron-app exec electron-builder --mac dir --publish never
fi

FOUND_APP="$(find_built_app)"

if [[ -z "$FOUND_APP" ]]; then
  echo -e "${RED}错误:${NC} 未找到 ${APP_NAME}.app，请检查构建是否成功" >&2
  echo -e "预期目录: ${DIST_DIR}" >&2
  exit 1
fi

echo ""
echo -e "${GREEN}[found]${NC} 找到产物: ${FOUND_APP}"

if [[ -d "$TARGET_APP_PATH" ]]; then
  echo -e "${YELLOW}[install]${NC} 已存在旧版本，先移除 ${TARGET_APP_PATH} ..."
  run_install_command rm -rf "$TARGET_APP_PATH"
fi

echo -e "${BLUE}[install]${NC} 安装到 ${INSTALL_DIR} ..."
run_install_command ditto "$FOUND_APP" "$TARGET_APP_PATH"

echo -e "${BLUE}[verify]${NC} 运行打包后烟测..."
node "$ROOT_DIR/scripts/verify-packaged-app.mjs" "$TARGET_APP_PATH"

echo ""
echo -e "${GREEN}[done]${NC} ${APP_NAME} 已安装到 ${TARGET_APP_PATH}"
echo -e "${GREEN}[done]${NC} 可在 Launchpad 或 Spotlight 中搜索 \"${APP_NAME}\" 启动"
