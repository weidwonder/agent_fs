# docker/Dockerfile

# ── Stage 1: Build ──────────────────────────────────────────
FROM rust:1.88-slim AS rust-toolchain
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet-sdk
FROM mcr.microsoft.com/dotnet/runtime:8.0 AS dotnet-runtime

FROM node:20 AS builder

COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
COPY --from=dotnet-sdk /usr/share/dotnet /usr/share/dotnet

ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:${PATH}
ENV DOTNET_ROOT=/usr/share/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV npm_config_disturl=https://npmmirror.com/mirrors/node

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg62-turbo-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9.15.9
RUN ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/indexer/package.json packages/indexer/
COPY packages/search/package.json packages/search/
COPY packages/llm/package.json packages/llm/
COPY packages/storage/package.json packages/storage/
COPY packages/storage-adapter/package.json packages/storage-adapter/
COPY packages/storage-cloud/package.json packages/storage-cloud/
COPY packages/server/package.json packages/server/
COPY packages/web-app/package.json packages/web-app/
COPY packages/plugins/plugin-markdown/package.json packages/plugins/plugin-markdown/
COPY packages/plugins/plugin-pdf/package.json packages/plugins/plugin-pdf/
COPY packages/plugins/plugin-docx/package.json packages/plugins/plugin-docx/
COPY packages/plugins/plugin-excel/package.json packages/plugins/plugin-excel/

RUN pnpm install --frozen-lockfile --child-concurrency=1

# Copy source
COPY packages/ packages/
COPY scripts/fix-esm-specifiers.mjs scripts/

# 仅构建云端部署需要的包，且显式控制顺序，避免工作区并行构建导致类型产物缺失。
# DOCX/Excel 插件的 .NET 产物复用仓库中的发布目录，规避 qemu 下的 dotnet publish 崩溃；
# 但 TypeScript 产物仍需在镜像内重新编译，避免把宿主机陈旧 dist 带进镜像。
RUN pnpm --filter @agent-fs/core build \
    && pnpm --filter @agent-fs/llm build \
    && pnpm --filter @agent-fs/storage build \
    && pnpm --filter @agent-fs/search build \
    && pnpm --filter @agent-fs/plugin-markdown build \
    && pnpm --filter @agent-fs/plugin-pdf build \
    && pnpm --filter @agent-fs/plugin-docx exec tsc \
    && pnpm --filter @agent-fs/plugin-excel exec tsc \
    && pnpm --filter @agent-fs/storage-adapter build \
    && pnpm --filter @agent-fs/indexer build \
    && pnpm --filter @agent-fs/storage-cloud build \
    && pnpm --filter @agent-fs/server build \
    && node scripts/fix-esm-specifiers.mjs \
      packages/core/dist \
      packages/llm/dist \
      packages/storage/dist \
      packages/search/dist \
      packages/plugins/plugin-markdown/dist \
      packages/plugins/plugin-pdf/dist \
      packages/plugins/plugin-docx/dist \
      packages/plugins/plugin-excel/dist \
      packages/storage-adapter/dist \
      packages/indexer/dist \
      packages/storage-cloud/dist \
      packages/server/dist
RUN pnpm --filter @agent-fs/web-app build

# ── Stage 2: Production ────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

COPY --from=dotnet-runtime /usr/share/dotnet /usr/share/dotnet
RUN apt-get update && apt-get install -y --no-install-recommends \
    libicu72 \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet

# Copy built artifacts from builder
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/core packages/core
COPY --from=builder /app/packages/indexer packages/indexer
COPY --from=builder /app/packages/search packages/search
COPY --from=builder /app/packages/llm packages/llm
COPY --from=builder /app/packages/storage packages/storage
COPY --from=builder /app/packages/storage-adapter packages/storage-adapter
COPY --from=builder /app/packages/storage-cloud packages/storage-cloud
COPY --from=builder /app/packages/server packages/server
COPY --from=builder /app/packages/web-app packages/web-app
COPY --from=builder /app/packages/plugins packages/plugins

ENV NODE_ENV=production
ENV DOTNET_ROOT=/usr/share/dotnet
EXPOSE 3000

# Default: server mode. Override with --mode=worker for worker.
CMD ["node", "packages/server/dist/index.js", "--mode=server"]
