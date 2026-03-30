# Phase 6: Docker Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Containerize the cloud server + worker with Docker, and provide a `docker-compose.yml` for one-command deployment with PostgreSQL + MinIO.

**Prerequisite:** Phase 4 + Phase 5 complete.

**Spec:** `docs/specs/2026-03-30-cloud-knowledge-base-design.md` §9

---

## File Map

```
docker/
├── Dockerfile                  # Multi-stage build: server + worker + web-app
├── docker-compose.yml          # Production-like: server, worker, PG, MinIO
├── docker-compose.dev.yml      # Dev: only PG + MinIO (code runs on host)
├── .env.example                # Environment variable template
└── init-db.sh                  # Run migration on first start
```

---

### Task 1: Dockerfile (Multi-stage)

**Files:**
- Create: `docker/Dockerfile`

- [ ] **Step 1: Write multi-stage Dockerfile**

```dockerfile
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

# Install dependencies
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

RUN corepack enable && corepack prepare pnpm@9 --activate

# Install system dependencies for plugins
RUN apt-get update && apt-get install -y --no-install-recommends \
    dotnet-runtime-8.0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts
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
COPY --from=builder /app/packages/plugins/ packages/plugins/

# Copy migration SQL
COPY --from=builder /app/packages/storage-cloud/src/migrations packages/storage-cloud/migrations

ENV NODE_ENV=production
EXPOSE 3000

# Default: server mode. Override with --mode=worker for worker.
CMD ["node", "packages/server/dist/index.js", "--mode=server"]
```

- [ ] **Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "feat(docker): add multi-stage Dockerfile for server + worker"
```

---

### Task 2: Docker Compose (Production)

**Files:**
- Create: `docker/docker-compose.yml`
- Create: `docker/.env.example`

- [ ] **Step 1: Write docker-compose.yml**

```yaml
# docker/docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-agentfs}
      POSTGRES_USER: ${POSTGRES_USER:-agentfs}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "${PG_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "${POSTGRES_USER:-agentfs}"]
      interval: 5s
      retries: 10

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY:-minioadmin}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY:-minioadmin}
    volumes:
      - miniodata:/data
    ports:
      - "${MINIO_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      retries: 10

  # Create default bucket on startup
  minio-init:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 ${S3_ACCESS_KEY:-minioadmin} ${S3_SECRET_KEY:-minioadmin};
        mc mb local/${S3_BUCKET:-agentfs} --ignore-existing;
      "

  # Run database migration
  migrate:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-agentfs}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-agentfs}
    command: >
      sh -c "node -e \"
        const { readFileSync } = require('fs');
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const sql = readFileSync('packages/storage-cloud/migrations/001-init-schema.sql', 'utf-8');
        pool.query(sql).then(() => { console.log('Migration complete'); pool.end(); }).catch(e => { console.error(e); process.exit(1); });
      \""

  server:
    build: .
    depends_on:
      migrate:
        condition: service_completed_successfully
      minio-init:
        condition: service_completed_successfully
    environment:
      PORT: "3000"
      DATABASE_URL: postgresql://${POSTGRES_USER:-agentfs}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-agentfs}
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: ${S3_BUCKET:-agentfs}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY:-minioadmin}
      S3_SECRET_KEY: ${S3_SECRET_KEY:-minioadmin}
      JWT_SECRET: ${JWT_SECRET:-change-me-in-production}
    ports:
      - "${APP_PORT:-3000}:3000"
    restart: unless-stopped

  worker:
    build: .
    depends_on:
      migrate:
        condition: service_completed_successfully
      minio-init:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-agentfs}:${POSTGRES_PASSWORD:-changeme}@postgres:5432/${POSTGRES_DB:-agentfs}
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: ${S3_BUCKET:-agentfs}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY:-minioadmin}
      S3_SECRET_KEY: ${S3_SECRET_KEY:-minioadmin}
    command: ["node", "packages/server/dist/index.js", "--mode=worker"]
    restart: unless-stopped

volumes:
  pgdata:
  miniodata:
```

- [ ] **Step 2: Write .env.example**

```bash
# docker/.env.example

# PostgreSQL
POSTGRES_DB=agentfs
POSTGRES_USER=agentfs
POSTGRES_PASSWORD=changeme
PG_PORT=5432

# MinIO / S3
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=agentfs
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
S3_ENDPOINT=http://minio:9000

# App
APP_PORT=3000
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
```

- [ ] **Step 3: Commit**

```bash
git add docker/
git commit -m "feat(docker): add docker-compose with server, worker, PostgreSQL, MinIO"
```

---

### Task 3: Dev Docker Compose (infra only)

**Files:**
- Create: `docker/docker-compose.dev.yml`

- [ ] **Step 1: Write dev compose**

```yaml
# docker/docker-compose.dev.yml
# Only infrastructure — run server/worker on host for hot-reload
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: agentfs_dev
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    volumes:
      - pgdata-dev:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "dev"]
      interval: 2s
      retries: 10

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - miniodata-dev:/data
    ports:
      - "9000:9000"
      - "9001:9001"

volumes:
  pgdata-dev:
  miniodata-dev:
```

- [ ] **Step 2: Commit**

```bash
git add docker/docker-compose.dev.yml
git commit -m "feat(docker): add dev compose for local PostgreSQL + MinIO"
```

---

### Task 4: End-to-End Smoke Test

- [ ] **Step 1: Start full stack**

```bash
cd /Users/weidwonder/projects/agent_fs/docker
cp .env.example .env
docker compose up --build -d
```

Wait for all services healthy.

- [ ] **Step 2: Verify health**

```bash
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

- [ ] **Step 3: Test auth flow**

```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"pass123","tenantName":"Test"}'

# Login
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","password":"pass123"}'
# Save accessToken from response
```

- [ ] **Step 4: Test project + upload**

```bash
TOKEN="<accessToken from login>"

# Create project
curl -X POST http://localhost:3000/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"My KB"}'

# Upload file
PROJECT_ID="<id from response>"
curl -X POST "http://localhost:3000/projects/$PROJECT_ID/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@README.md"
```

- [ ] **Step 5: Verify Web UI**

Open `http://localhost:3000` in browser. Verify login, project list, file upload.

- [ ] **Step 6: Cleanup**

```bash
docker compose down
```

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix(docker): resolve deployment issues from smoke test"
```

---

## Phase 6 Success Criteria

- [ ] `docker compose up --build` starts all services without errors
- [ ] Database migration runs automatically
- [ ] MinIO bucket created automatically
- [ ] Server responds on port 3000 with health check
- [ ] Auth register/login works
- [ ] File upload triggers indexing job
- [ ] Worker picks up and processes jobs
- [ ] Web UI accessible and functional
- [ ] Dev compose provides PG + MinIO for local development
