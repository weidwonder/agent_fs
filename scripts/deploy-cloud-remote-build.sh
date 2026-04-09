#!/usr/bin/env bash
# 远端构建并发布云端镜像到既有服务器。
# 默认目标是 182.92.22.224，适用于当前离线式部署环境：
# - 远端 Docker 缓存可复用
# - 远端部署目录固定为 /opt/agent-fs
# - 通过修改 /opt/agent-fs/docker/.env 中的 APP_IMAGE 切换镜像

set -euo pipefail

show_usage() {
  cat <<'EOF'
用法:
  ./scripts/deploy-cloud-remote-build.sh [选项]

选项:
  --host <host>              目标主机，默认 182.92.22.224
  --user <user>              SSH 用户，默认 root
  --remote-dir <dir>         远端部署目录，默认 /opt/agent-fs
  --app-port <port>          健康检查端口，默认 1202
  --image-repo <name>        镜像仓库名，默认 agent-fs-cloud
  --tag <tag>                镜像标签，默认 deploy-YYYYMMDD-HHMMSS
  --skip-push                跳过 git push
  --allow-dirty              允许带未提交改动执行（默认禁止）
  --keep-build-dir           保留远端临时构建目录（默认成功后删除）
  -h, --help                 显示帮助

示例:
  ./scripts/deploy-cloud-remote-build.sh
  ./scripts/deploy-cloud-remote-build.sh --tag 20260409-markdown-tools-v3
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="182.92.22.224"
SSH_USER="root"
REMOTE_DIR="/opt/agent-fs"
APP_PORT="1202"
IMAGE_REPO="agent-fs-cloud"
STAMP="$(date +%Y%m%d-%H%M%S)"
IMAGE_TAG="deploy-${STAMP}"
SKIP_PUSH="false"
ALLOW_DIRTY="false"
KEEP_BUILD_DIR="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --user)
      SSH_USER="$2"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="$2"
      shift 2
      ;;
    --app-port)
      APP_PORT="$2"
      shift 2
      ;;
    --image-repo)
      IMAGE_REPO="$2"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --skip-push)
      SKIP_PUSH="true"
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY="true"
      shift
      ;;
    --keep-build-dir)
      KEEP_BUILD_DIR="true"
      shift
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      echo "错误: 不支持的参数 $1" >&2
      show_usage
      exit 1
      ;;
  esac
done

for cmd in git ssh scp tar curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "错误: 未找到命令 $cmd" >&2
    exit 1
  fi
done

cd "$ROOT_DIR"

if [[ "$ALLOW_DIRTY" != "true" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 当前工作区有未提交改动，请先提交或使用 --allow-dirty" >&2
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "错误: 无法识别当前分支" >&2
  exit 1
fi

IMAGE_NAME="${IMAGE_REPO}:${IMAGE_TAG}"
REMOTE_BUILD_DIR="${REMOTE_DIR}/build-src-${IMAGE_TAG}"
REMOTE_DOCKER_DIR="${REMOTE_DIR}/docker"
SSH_TARGET="${SSH_USER}@${HOST}"

echo "[1/6] 当前分支: ${CURRENT_BRANCH}"
echo "[1/6] 目标镜像: ${IMAGE_NAME}"

if [[ "$SKIP_PUSH" != "true" ]]; then
  echo "[2/6] 推送当前分支到 origin/${CURRENT_BRANCH}..."
  git push origin "$CURRENT_BRANCH"
else
  echo "[2/6] 跳过 git push"
fi

echo "[3/6] 上传构建上下文到 ${SSH_TARGET}:${REMOTE_BUILD_DIR} ..."
ssh -o BatchMode=yes "$SSH_TARGET" "rm -rf '$REMOTE_BUILD_DIR' && mkdir -p '$REMOTE_BUILD_DIR'"
tar -C "$ROOT_DIR" -czf - \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  tsconfig.json \
  tsconfig.base.json \
  docker \
  scripts/fix-esm-specifiers.mjs \
  packages/core \
  packages/indexer \
  packages/search \
  packages/llm \
  packages/storage \
  packages/storage-adapter \
  packages/storage-cloud \
  packages/server \
  packages/web-app \
  packages/plugins \
  | ssh -o BatchMode=yes "$SSH_TARGET" "tar -xzf - -C '$REMOTE_BUILD_DIR'"

echo "[4/6] 在远端构建镜像 ${IMAGE_NAME} ..."
ssh -o BatchMode=yes "$SSH_TARGET" \
  "cd '$REMOTE_BUILD_DIR' && docker build -f docker/Dockerfile -t '$IMAGE_NAME' ."

echo "[5/6] 切换 APP_IMAGE 并重启服务 ..."
ssh -o BatchMode=yes "$SSH_TARGET" "
  set -euo pipefail
  cp '$REMOTE_DOCKER_DIR/.env' '$REMOTE_DOCKER_DIR/.env.bak.$(date +%Y%m%d-%H%M%S)'
  sed -i 's#^APP_IMAGE=.*#APP_IMAGE=$IMAGE_NAME#' '$REMOTE_DOCKER_DIR/.env'
  cd '$REMOTE_DOCKER_DIR'
  docker compose -f docker-compose.yml -f docker-compose.public-ip.yml --env-file .env up -d --no-build
"

echo "[6/6] 健康检查 ..."
for _ in $(seq 1 30); do
  if curl -fsS "http://${HOST}:${APP_PORT}/health" >/dev/null; then
    break
  fi
  sleep 2
done
HEALTH_RESPONSE="$(curl -fsS "http://${HOST}:${APP_PORT}/health")"
echo "[done] health => ${HEALTH_RESPONSE}"

if [[ "$KEEP_BUILD_DIR" != "true" ]]; then
  echo "[cleanup] 删除远端临时构建目录 ${REMOTE_BUILD_DIR}"
  ssh -o BatchMode=yes "$SSH_TARGET" "rm -rf '$REMOTE_BUILD_DIR'"
else
  echo "[cleanup] 保留远端临时构建目录 ${REMOTE_BUILD_DIR}"
fi

echo ""
echo "部署完成:"
echo "  主机: ${HOST}"
echo "  镜像: ${IMAGE_NAME}"
echo "  健康检查: http://${HOST}:${APP_PORT}/health"
