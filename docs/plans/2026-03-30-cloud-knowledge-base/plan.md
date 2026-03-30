# Cloud Knowledge Base Refactor — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Agent FS from a local-only desktop app into a multi-tenant SaaS cloud knowledge base while preserving the Electron local version.

**Architecture:** Storage Adapter abstraction layer decouples core logic (indexer/search) from storage backends. LocalAdapter wraps existing LanceDB/SQLite/AFD for Electron. CloudAdapter implements pgvector + PostgreSQL BM25 + S3/MinIO for cloud. New Fastify HTTP server provides REST API + MCP Streamable HTTP. React Web UI replaces Electron for cloud users.

**Tech Stack:** TypeScript, Fastify, PostgreSQL + pgvector, S3/MinIO, pg-boss, React + Vite + TailwindCSS, Docker Compose

**Spec:** `docs/specs/2026-03-30-cloud-knowledge-base-design.md`
**Review:** `plans/reports/review-260330-1336-cloud-refactor-plan.md`

---

## Phases Overview

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | 契约冻结 + Conformance Tests | ✅ |
| 1 | Storage Adapter + LocalAdapter + LocalMetadataAdapter | ✅ |
| 2 | Refactor indexer/search/mcp/electron to use adapters | ✅ |
| 3 | CloudAdapter + CloudMetadataAdapter + shared conformance tests | ✅ |
| 4A | Auth + Tenant + Project CRUD + 服务层基础 | ✅ |
| 4B | Upload + Worker + IndexPipeline 接入 + SSE | ✅ |
| 4C | Search + MCP 完整工具 parity | ✅ |
| 5 | Web UI | ✅ |
| 6 | Docker deployment | ✅ |

**Detailed phase files:**
- [Phase 0](./phase-00-contract-freeze.md) — 契约冻结
- [Phase 1](./phase-01-storage-adapter.md) — 适配器接口 + 本地实现
- [Phase 2](./phase-02-refactor-core.md) — 核心包迁移
- [Phase 3](./phase-03-cloud-adapter.md) — 云端适配器
- [Phase 4A](./phase-04a-auth-project.md) — Auth + 项目管理
- [Phase 4B](./phase-04b-indexing-pipeline.md) — 索引流水线
- [Phase 4C](./phase-04c-search-mcp.md) — 搜索 + MCP
- [Phase 5](./phase-05-web-ui.md) — Web UI
- [Phase 6](./phase-06-docker.md) — Docker 部署

---

## Key Dependencies

```
Phase 0 (契约冻结)
    ↓
Phase 1 (adapter interfaces + LocalAdapter + LocalMetadataAdapter)
    ↓
Phase 2 (refactor core)    Phase 3 (cloud adapter)  ← 可并行
    ↓                          ↓
    └─────────┬────────────────┘
              ↓
Phase 4A (auth + project CRUD)
    ↓
Phase 4B (upload + worker + real indexing)  Phase 5 (Web UI 骨架) ← 可并行
    ↓                                           ↓
Phase 4C (search + MCP parity)             Phase 5 (搜索页接入)
    ↓                                           ↓
    └──────────────┬────────────────────────────┘
                   ↓
Phase 6 (Docker)   Phase 6A (dev compose) ← 可提前到 Phase 3 后
```

## v2 修订要点（基于审查报告）

1. **新增 Phase 0**：冻结 StorageAdapter + MetadataAdapter 契约，同步 Spec
2. **MetadataAdapter 不再占位**：Phase 1 实现 LocalMetadataAdapter，Phase 3 实现 CloudMetadataAdapter
3. **Phase 4 拆为 4A/4B/4C**：4B 真正接入 IndexPipeline，闭合索引链路
4. **统一服务层**：server 引入 Service 层（AuthService / ProjectService / SearchService / McpToolService），route 和 MCP 复用同一层
5. **向量维度可配置**：不再硬编码 1024，由租户配置决定
6. **storage-cloud 导出面对齐**：确保 Phase 4 所需的 getPool/initDb/putObject 等全部导出
7. **补齐数据库索引**：tenant_members(user_id)、directories(parent_dir_id)、files(directory_id,name) UNIQUE 等
8. **adapter 生命周期统一**：createXAdapter() 只组装，显式 init()/close()，server 走单例
