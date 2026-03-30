# docker/Dockerfile

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json packages/core/
COPY packages/indexer/package.json packages/indexer/
COPY packages/search/package.json packages/search/
COPY packages/llm/package.json packages/llm/
COPY packages/storage-adapter/package.json packages/storage-adapter/
COPY packages/storage-cloud/package.json packages/storage-cloud/
COPY packages/server/package.json packages/server/
COPY packages/web-app/package.json packages/web-app/
COPY packages/plugins/plugin-markdown/package.json packages/plugins/plugin-markdown/
COPY packages/plugins/plugin-pdf/package.json packages/plugins/plugin-pdf/
COPY packages/plugins/plugin-docx/package.json packages/plugins/plugin-docx/
COPY packages/plugins/plugin-excel/package.json packages/plugins/plugin-excel/

# Install build tools for native modules (nodejieba) and .NET SDK for DOCX/XLSX plugins
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ wget apt-transport-https ca-certificates \
    && wget https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/ms.deb \
    && dpkg -i /tmp/ms.deb && rm /tmp/ms.deb \
    && apt-get update && apt-get install -y --no-install-recommends dotnet-sdk-8.0 \
    && rm -rf /var/lib/apt/lists/*

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY tsconfig.json ./

# Build all packages
RUN pnpm -r build

# Build web-app
RUN cd packages/web-app && pnpm build

# ── Stage 2: Production ────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/indexer/dist packages/indexer/dist
COPY --from=builder /app/packages/indexer/package.json packages/indexer/
COPY --from=builder /app/packages/search/dist packages/search/dist
COPY --from=builder /app/packages/search/package.json packages/search/
COPY --from=builder /app/packages/llm/dist packages/llm/dist
COPY --from=builder /app/packages/llm/package.json packages/llm/
COPY --from=builder /app/packages/storage-adapter/dist packages/storage-adapter/dist
COPY --from=builder /app/packages/storage-adapter/package.json packages/storage-adapter/
COPY --from=builder /app/packages/storage-cloud/dist packages/storage-cloud/dist
COPY --from=builder /app/packages/storage-cloud/package.json packages/storage-cloud/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/web-app/dist packages/web-app/dist

# Copy plugins (may include native binaries already built)
COPY --from=builder /app/packages/plugins packages/plugins

# Copy migration SQL
COPY --from=builder /app/packages/storage-cloud/src/migrations packages/storage-cloud/migrations

# Install .NET 8 runtime for DOCX/XLSX plugin support
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget apt-transport-https ca-certificates && \
    wget https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/ms.deb && \
    dpkg -i /tmp/ms.deb && rm /tmp/ms.deb && \
    apt-get update && apt-get install -y --no-install-recommends dotnet-runtime-8.0 && \
    rm -rf /var/lib/apt/lists/*
# Without .NET, DOCX/XLSX plugins are skipped (worker logs a warning); Markdown/PDF still work.

ENV NODE_ENV=production
EXPOSE 3000

# Default: server mode. Override with --mode=worker for worker.
CMD ["node", "packages/server/dist/index.js", "--mode=server"]
