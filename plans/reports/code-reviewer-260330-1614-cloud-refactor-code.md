# Cloud Knowledge Base Refactor -- Code Review Report

**Date:** 2026-03-30
**Reviewer:** code-reviewer
**Scope:** 14 commits (ba9f35e..8652845), 79 files changed, ~8046 LOC added
**Packages:** storage-adapter, storage-cloud, server, web-app, docker, indexer (refactored), mcp-server (refactored)

---

## Dimension Ratings

| # | Dimension | Rating | Summary |
|---|-----------|--------|---------|
| 1 | Interface Contract Consistency | GOOD | StorageAdapter interface is well-designed and consistently implemented |
| 2 | Security | CRITICAL | Multiple issues: no input validation, no rate limiting, tenant isolation gaps |
| 3 | Error Handling | WARNING | Decent try/catch coverage but missing transaction safety in several paths |
| 4 | Tenant Isolation | CRITICAL | CloudMetadataAdapter queries bypass tenant_id filtering |
| 5 | Performance | WARNING | Missing composite indexes, potential N+1 in BM25 stats queries |
| 6 | Code Quality | GOOD | Clean separation, DRY, reasonable file sizes |
| 7 | Docker Configuration | WARNING | Default secrets in production compose, no resource limits |
| 8 | Frontend | WARNING | Token in localStorage (XSS-vulnerable), token leaked in EventSource URL |
| 9 | MCP Implementation | GOOD | 6 tools, correct JSON-RPC 2.0, proper adapter lifecycle |
| 10 | Test Coverage | CRITICAL | Zero tests for server, storage-cloud, web-app packages |

---

## 1. Interface Contract Consistency -- GOOD

The `StorageAdapter` composite interface in `packages/storage-adapter/src/types.ts` is well-structured with clear sub-interfaces (VectorStoreAdapter, InvertedIndexAdapter, DocumentArchiveAdapter, MetadataAdapter). Both local and cloud implementations conform correctly.

**Positive:**
- Factory pattern (`createCloudAdapter`, `createLocalAdapter`) keeps construction clean
- `init()` / `close()` lifecycle is consistently followed
- The refactored `packages/mcp-server/src/tools/search.ts` and `packages/indexer/src/pipeline.ts` both use the adapter interface cleanly

**Minor:**
- `CloudVectorStoreAdapter.rowToDocument()` returns `content_vector: []` (line 154) -- this is acceptable since vectors are not needed after retrieval, but should be documented in the interface contract

---

## 2. Security -- CRITICAL

### Critical Issues

**C-01: No input validation on any route** (High)
- Files: `packages/server/src/routes/auth-routes.ts`, `document-routes.ts`, `project-routes.ts`, `search-routes.ts`
- No email format validation, no password length/complexity checks, no request body schema validation
- `auth-routes.ts:8-9` casts `request.body as { email, password }` with zero validation
- **Impact:** Allows empty passwords, malformed emails, excessively large payloads
- **Fix:** Add Fastify JSON Schema validation or use `@fastify/type-provider-typebox`

```typescript
// Example fix for auth-routes.ts
const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      tenantName: { type: 'string', maxLength: 100 },
    },
  },
};
app.post('/auth/register', { schema: registerSchema }, async (request, reply) => { ... });
```

**C-02: No rate limiting on authentication endpoints** (High)
- Files: `packages/server/src/routes/auth-routes.ts`
- `/auth/login` and `/auth/register` have no rate limiting, enabling brute-force attacks
- **Fix:** Add `@fastify/rate-limit` with stricter limits on auth endpoints

**C-03: JWT secret defaults to hardcoded value** (High)
- File: `packages/server/src/config.ts:25`
- `jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production'`
- A forgotten env var means production runs with a known secret
- **Fix:** Throw an error if `JWT_SECRET` is not set in production (`NODE_ENV=production`)

**C-04: SSRF via index_documents tool** (High)
- File: `packages/server/src/services/mcp-tool-service.ts:127`
- `fetch(url)` with user-provided URLs allows SSRF to internal services (e.g., `http://169.254.169.254/`)
- **Fix:** Validate URL scheme (https only) and block private IP ranges

**C-05: Token exposed in EventSource URL query parameter** (Medium)
- File: `packages/web-app/src/api/client.ts:82`
- `?token=${encodeURIComponent(accessToken)}` -- tokens in URLs appear in server logs, browser history, proxy logs
- **Fix:** Use a short-lived SSE ticket obtained via authenticated POST, or use cookie-based auth for SSE

### Medium Issues

**C-06: Tokens stored in localStorage** (Medium)
- File: `packages/web-app/src/api/client.ts:3-4`
- localStorage is accessible to any JS on the page (XSS attack surface)
- Consider httpOnly cookies for the refresh token at minimum

**C-07: No CORS origin restriction** (Medium)
- File: `packages/server/src/app.ts:30`
- `cors({ origin: true })` allows any origin -- acceptable for dev, not for production
- **Fix:** Configure allowed origins from env var

---

## 3. Error Handling -- WARNING

**Positive:**
- Auth service uses proper transactions with BEGIN/ROLLBACK/COMMIT (`auth-service.ts:29-61`)
- Error handler maps domain errors to HTTP status codes cleanly (`error-handler.ts`)
- Worker has try/catch with file status update on failure (`indexing-worker.ts:185-192`)

### Issues

**E-01: indexing-service.ts uploadAndEnqueue lacks transaction** (High)
- File: `packages/server/src/services/indexing-service.ts:21-62`
- Creates file record, uploads to S3, enqueues job in separate operations
- If S3 upload fails, orphan DB record remains with status `pending` forever
- If enqueue fails, file is uploaded to S3 but never processed
- **Fix:** Wrap in transaction; use S3 upload first, then DB+enqueue in a transaction

**E-02: Worker does not handle partial failures atomically** (Medium)
- File: `packages/server/src/jobs/indexing-worker.ts:138-151`
- Vector docs and inverted index entries are written separately
- If `addFile` fails after `addDocuments` succeeds, the data is inconsistent
- **Fix:** Consider wrapping vector + inverted writes in a DB transaction

**E-03: SSE interval not error-safe** (Low)
- File: `packages/server/src/routes/indexing-event-routes.ts:28-43`
- If `pool.query` throws, the catch silently swallows -- interval keeps polling a possibly dead connection
- Should clear interval on repeated failures

---

## 4. Tenant Isolation -- CRITICAL

### Critical Issues

**T-01: CloudMetadataAdapter.readIndexMetadata lacks tenant_id check** (Critical)
- File: `packages/storage-cloud/src/cloud-metadata-adapter.ts:15-19`
- `SELECT metadata FROM directories WHERE id = $1` -- any tenant can read any directory's metadata if they know the UUID
- **Fix:** Join to projects table and filter by tenant_id:
```sql
SELECT d.metadata FROM directories d
JOIN projects p ON d.project_id = p.id
WHERE d.id = $1 AND p.tenant_id = $2
```

**T-02: CloudMetadataAdapter.listSubdirectories lacks tenant_id check** (Critical)
- File: `packages/storage-cloud/src/cloud-metadata-adapter.ts:42-44`
- `SELECT ... FROM directories WHERE parent_dir_id = $1` -- no tenant scoping
- Same fix: join to projects and filter by tenant_id

**T-03: CloudMetadataAdapter.writeIndexMetadata lacks tenant_id check** (Critical)
- File: `packages/storage-cloud/src/cloud-metadata-adapter.ts:25-29`
- `UPDATE directories SET metadata = $1 WHERE id = $2` -- any tenant can overwrite metadata
- Same fix pattern

**T-04: CloudMetadataAdapter.deleteIndexMetadata lacks tenant_id check** (Critical)
- File: `packages/storage-cloud/src/cloud-metadata-adapter.ts:32-35`
- Same issue

**T-05: inverted_stats table has no tenant_id column** (High)
- File: `packages/storage-cloud/src/migrations/001-init-schema.sql:126-130`
- BM25 stats are scoped by dir_id only, but `inverted_stats` queries in `cloud-inverted-index-adapter.ts:124-139` do not filter by tenant
- While dir_ids are tenant-scoped via the calling layer, the stats query itself crosses tenant boundaries when dir_ids are not provided (empty scope)
- **Fix:** Add tenant_id to inverted_stats or always require dir_id scoping

**T-06: McpToolService.getChunk does not verify tenant ownership** (High)
- File: `packages/server/src/services/mcp-tool-service.ts:79-106`
- `void tenantId` -- tenantId is explicitly ignored
- A user can retrieve any chunk by ID across tenants
- **Fix:** Pass tenantId to adapter and verify chunk belongs to tenant

**T-07: directories table lacks tenant_id column** (Medium)
- File: `packages/storage-cloud/src/migrations/001-init-schema.sql:54-62`
- Directories are scoped via `project_id -> projects.tenant_id`, but this requires JOINs for every access
- The `indexing-service.ts:31` query adds `AND tenant_id = $2` but the directories table has no `tenant_id` column -- this query will fail at runtime
- **Fix:** Either add tenant_id to directories or fix the query to use a JOIN

---

## 5. Performance -- WARNING

### Issues

**P-01: Missing composite index on inverted_terms(term, dir_id, tenant_id)** (Medium)
- File: `packages/storage-cloud/src/migrations/001-init-schema.sql:121`
- Current index is `(term, dir_id)` -- BM25 search also filters by tenant_id, which is not in the index
- **Fix:** `CREATE INDEX idx_inverted_term_dir_tenant ON inverted_terms(term, dir_id, tenant_id)`

**P-02: CloudAdapter created per-request in search/MCP routes** (Medium)
- Files: `packages/server/src/routes/search-routes.ts:28`, `packages/server/src/mcp/streamable.ts:175`
- `createCloudAdapter({ tenantId })` + init + close on every request
- While init/close are currently no-ops, this pattern adds overhead and creates a new object graph per request
- **Fix:** Consider a per-tenant adapter cache or make adapters stateless (they already are essentially)

**P-03: BM25 scoring computed entirely in application layer** (Low)
- File: `packages/storage-cloud/src/cloud-inverted-index-adapter.ts:164-194`
- For large corpora, fetching all matching postings and computing BM25 in JS is inefficient
- Acceptable for MVP; consider moving scoring to a PostgreSQL function later

**P-04: addDocuments builds one giant INSERT** (Low)
- File: `packages/storage-cloud/src/cloud-vector-store-adapter.ts:28-67`
- For large batches, this can exceed PostgreSQL parameter limits (65535 params)
- With 11 params per doc, limit is ~5958 docs -- unlikely in practice but should batch

---

## 6. Code Quality -- GOOD

**Positive:**
- Clean module boundaries, each package has a clear responsibility
- Files are well within the 200-line limit (largest is indexing-worker.ts at 271 lines)
- Consistent naming conventions (kebab-case files, PascalCase classes)
- DI pattern in server is clean and testable
- Factory pattern for adapters is KISS-compliant

### Issues

**Q-01: Duplicated buildEmbeddingConfig** (Medium)
- Files: `packages/server/src/app.ts:97-122`, `packages/server/src/jobs/indexing-worker.ts:199-224`
- Identical function duplicated -- violates DRY
- **Fix:** Extract to a shared module like `packages/server/src/config.ts`

**Q-02: Duplicated tokenization logic** (Low)
- `cloud-inverted-index-adapter.ts` has its own tokenizer; the local inverted index likely has similar logic
- Consider sharing via a `@agent-fs/core` tokenize utility

**Q-03: `void randomUUID` dead code** (Low)
- File: `packages/server/src/jobs/indexing-worker.ts:271`
- `randomUUID` is imported but never used, suppressed with `void`
- **Fix:** Remove the import entirely

---

## 7. Docker Configuration -- WARNING

### Issues

**D-01: No resource limits on containers** (Medium)
- File: `docker/docker-compose.yml`
- No `mem_limit`, `cpus`, or `deploy.resources` -- a runaway worker can OOM the host
- **Fix:** Add resource limits for production

**D-02: Default credentials in compose** (Medium)
- File: `docker/docker-compose.yml:9,87`
- `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}`, `JWT_SECRET: ${JWT_SECRET:-change-me-in-production}`
- Fallback defaults mean accidental production deployment with weak secrets
- **Fix:** Remove defaults for sensitive values or require explicit `.env` file

**D-03: Production image copies entire node_modules** (Medium)
- File: `docker/Dockerfile:51`
- `COPY --from=builder /app/node_modules ./node_modules` copies ALL dependencies including devDependencies
- **Fix:** Run `pnpm install --prod` in production stage or prune

**D-04: No health check for server/worker containers** (Low)
- File: `docker/docker-compose.yml:71-92`
- PostgreSQL and MinIO have health checks, but server and worker do not
- **Fix:** Add health check using `/health` endpoint for server

---

## 8. Frontend -- WARNING

**Positive:**
- Clean React patterns with context/hooks
- API client has automatic token refresh with 401 retry
- No dangerouslySetInnerHTML usage (no XSS via React rendering)

### Issues

**F-01: Token in localStorage** (Medium)
- Already noted in C-06

**F-02: Token in EventSource URL** (Medium)
- Already noted in C-05

**F-03: uploadFiles sends FormData but route expects single file** (Medium)
- File: `packages/web-app/src/api/client.ts:60-79`
- Appends multiple files with `formData.append('file', file)` in a loop
- But `document-routes.ts:22` uses `request.file()` (singular) -- only the first file is processed
- **Fix:** Either use `request.files()` on server or loop upload calls on client

**F-04: JWT payload parsed with atob without validation** (Low)
- File: `packages/web-app/src/auth/auth-context.tsx:35`
- `JSON.parse(atob(token.split('.')[1]!))` -- if token is malformed, this throws
- Wrapped in try/catch, so functional but could log errors

---

## 9. MCP Implementation -- GOOD

**Positive:**
- All 6 tools defined with proper JSON Schema inputSchema
- JSON-RPC 2.0 protocol correctly implemented
- Proper adapter init/close lifecycle in `callTool` with try/finally
- Tools/list available via both RPC method and GET convenience endpoint

### Issues

**M-01: No MCP initialization handshake** (Low)
- The streamable HTTP transport doesn't implement the full MCP initialization protocol (`initialize` method)
- Acceptable for initial implementation but may cause issues with strict MCP clients

**M-02: No input validation in callTool** (Medium)
- File: `packages/server/src/mcp/streamable.ts:158-227`
- Tool arguments are cast directly without validation: `args['query'] as string`
- Missing required args will pass `undefined` to services
- **Fix:** Validate required fields match inputSchema before calling service

---

## 10. Test Coverage -- CRITICAL

### Issues

**TS-01: Zero tests for new packages** (Critical)
- `packages/server/` -- 0 test files
- `packages/storage-cloud/` -- 0 test files
- `packages/web-app/` -- 0 test files
- These are the core new packages in this refactor

**TS-02: Existing tests updated but not expanded** (High)
- `packages/indexer/src/pipeline.test.ts` -- modified for StorageAdapter but tests cover local path only
- `packages/mcp-server/src/tools/search.test.ts` -- updated but no cloud-mode tests
- No integration tests for cloud storage adapters

**Priority test targets:**
1. AuthService (register, login, refresh, edge cases)
2. Tenant isolation in CloudMetadataAdapter
3. CloudVectorStoreAdapter / CloudInvertedIndexAdapter (with test DB)
4. SearchService RRF fusion logic
5. IndexingWorker job processing

---

## Edge Cases Found by Scouting

1. **directories.tenant_id column mismatch**: `indexing-service.ts:31` queries `directories WHERE tenant_id = $2`, but the `directories` table schema has no `tenant_id` column -- this will throw a runtime SQL error on file upload
2. **BM25 doc length normalization**: `cloud-inverted-index-adapter.ts:179` uses `(1 - b + b)` which simplifies to 1 when `avg_len` is not used -- the doc length normalization term is incomplete (should be `1 - b + b * (docLen / avgDocLen)`)
3. **S3 key path traversal**: `cloud-archive-adapter.ts:9` constructs keys as `${tenantId}/${fileId}/${fileName}` -- if fileName contains `../`, it could write to other tenants' paths
4. **Concurrent registration race**: `auth-service.ts:23` checks `SELECT id FROM users WHERE email = $1` then inserts -- TOCTOU race between check and insert (mitigated by UNIQUE constraint, but error message would be wrong)

---

## Overall Assessment

This is a solid architectural foundation for the cloud refactor. The StorageAdapter abstraction is well-designed, the package separation is clean, and the code is readable and maintainable. However, the implementation has critical security gaps that **must** be addressed before any deployment:

1. **Tenant isolation in CloudMetadataAdapter is broken** -- 4 methods query directories without tenant scoping
2. **directories.tenant_id query will fail at runtime** -- schema mismatch
3. **No input validation anywhere** -- all endpoints accept arbitrary payloads
4. **No tests for any new package** -- these are not optional for a multi-tenant system

### Recommended Actions (Priority Order)

1. **[P0] Fix tenant isolation in CloudMetadataAdapter** -- add tenant_id filtering to all 4 methods
2. **[P0] Fix directories table query in indexing-service.ts** -- either add tenant_id column or fix query to JOIN
3. **[P0] Fix getChunk tenant verification** -- stop ignoring tenantId
4. **[P1] Add input validation** -- Fastify JSON Schema on all routes
5. **[P1] Add rate limiting** -- especially on auth endpoints
6. **[P1] Fail on missing JWT_SECRET in production**
7. **[P1] Fix SSRF in index_documents** -- URL allowlist/blocklist
8. **[P1] Write tests** -- at minimum for auth, tenant isolation, search service
9. **[P2] Fix BM25 normalization formula**
10. **[P2] Extract duplicated buildEmbeddingConfig**
11. **[P2] Fix multi-file upload mismatch**
12. **[P2] Add Docker health checks and resource limits**
13. **[P3] Move token storage from localStorage to httpOnly cookies**
14. **[P3] Add composite index for inverted_terms**

### Metrics

- Type Coverage: ~85% (heavy use of `as` casts, several `any` types in JWT payloads)
- Test Coverage: ~0% for new packages, existing packages lightly covered
- Linting Issues: Not run (no lint script observed), `void randomUUID` dead code

### Unresolved Questions

1. Is the `directories` table intended to have a `tenant_id` column? The `indexing-service.ts` query suggests yes, but the migration SQL says no.
2. Is the `content_vector vector(1024)` dimension hardcoded intentionally? What if the embedding model dimension changes?
3. Should the BM25 implementation be replaced with PostgreSQL `pg_bm25` extension or `tsvector` for better performance at scale?
4. Is the current "polling SSE" approach (2-second interval query) acceptable, or should it use PostgreSQL LISTEN/NOTIFY?
