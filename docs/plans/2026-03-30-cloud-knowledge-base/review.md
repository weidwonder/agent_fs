# Agent FS 云端知识库重构实施计划审查报告

## 结论

当前实施计划的总体方向正确：以 `StorageAdapter` 解耦本地与云端存储、保留 Electron 本地版、引入 `Fastify + PostgreSQL + S3 + Web UI` 的云端形态，这条主线与 Spec 一致。

但计划还 **不能直接进入执行**。目前有 4 个阻塞级问题：

1. `StorageAdapter` 契约在 Spec、Phase 1 和现有代码之间已经发生漂移，且 `metadata` 被定义后又以 `null as any` 占位，后续会卡住目录树、索引元数据、云端 MCP 工具实现。
2. 云端元数据闭环没有完成。Spec 要求把 `index.json`/`Registry` 语义迁移到数据库，但计划没有给出 `CloudMetadataAdapter` 的实现任务，也没有给 `dir_tree`、`get_project_memory`、`get_chunk` 的云端等价方案。
3. Phase 4 的 worker 仍是占位实现，`TODO: Call indexer pipeline with adapter` 说明“上传 -> 入队 -> 真正索引 -> SSE 通知”的核心链路尚未闭合。
4. 多处 phase 之间的接口依赖不自洽，例如 Phase 4 直接从 `@agent-fs/storage-cloud` 导入 `getPool`、`initDb`、`putObject`、`getObject`，但 Phase 3 的导出草案并没有暴露这些 API。

建议先修订计划，再进入实施。

## 1. Spec 覆盖度

### 已覆盖

- 存储抽象层、本地/云端双后端、保留 Electron 本地版。
- 云端基础设施选型：`Fastify`、`pgvector`、`pg-boss`、`S3/MinIO`、`React + Vite`、Docker。
- 基础认证流：注册、登录、刷新 token。
- 基础项目能力：项目 CRUD、上传、搜索、MCP HTTP 端点。

### 明显遗漏或仅部分覆盖

1. **SSE 索引进度**
   - Spec 明确要求 `GET /projects/:id/indexing-events` 和前端 SSE 进度展示。
   - Phase 4 只有文件树占位，没有实现任务；Phase 5 也没有接入 `EventSource`。
   - 这会导致“上传后可见进度”这一核心体验缺失。

2. **MCP 工具覆盖不完整**
   - Spec 要求“保持现有 5 个工具 + 新增 `index_documents`”。
   - 计划中的云端 MCP 只列出了 `list_indexes`、`search`、`get_chunk`、`index_documents`，缺少 `dir_tree`、`get_project_memory`。
   - 且实现里只有 `list_indexes` 有真实逻辑，其余工具明确写着 `not yet implemented`。

3. **云端元数据替代方案未落地**
   - Spec 指定：云端 `IndexMetadata` 存入 `directories` 表，`Registry` 由 `tenants + projects` 替代。
   - 计划虽然引入了 `MetadataAdapter`/`cloud-metadata-adapter.ts`，但没有任何任务实现它。
   - 结果是目录树、增量清理、统计聚合、项目概况都会缺少统一数据来源。

4. **索引工作流未闭合**
   - Spec 要求 Worker 执行“下载 -> 插件转换 -> chunk -> embedding -> summary -> CloudAdapter 写入 -> files 表更新 -> SSE 通知”。
   - Phase 4 worker 目前只下载临时文件，然后直接把状态改成 `indexed`，没有真正调用索引流水线。

5. **Web UI 能力缺失**
   - Spec 中的“设置页（LLM/Embedding 配置、成员管理）”没有对应任务。
   - “搜索范围选择”没有实现。
   - “项目详情概况”缺少文件数、chunk 数、索引版本、summary 覆盖率、增量更新/补全 summary/重新索引动作。
   - “索引进度通过 SSE 推送”未覆盖。
   - 当前实际部署仍主要依赖服务端环境变量或 `docker/.env` 管理运行配置，尚未像本地 Electron 版那样提供可视化设置面板。

6. **租户配置与配额没有业务实现**
   - Spec 有 `tenants.config`、`storage_quota_bytes`。
   - 计划只有表字段，没有任何配额校验、配置读写 API、UI 配置入口。

7. **OAuth / API Key 仅部分预留**
   - `api_keys` 表和 `oauth_provider/oauth_id` 字段有了，但没有认证抽象层，也没有在服务端设计里预留扩展点。
   - 这不算阻塞，但属于“仅 schema 级预留”。

8. **部署拓扑与运维要素覆盖不完整**
   - Spec 里明确画出了 `Nginx -> Server/Worker/PostgreSQL/MinIO`。
   - 计划只有 Docker Compose，没有反向代理、路径路由、静态资源缓存、MCP 路由代理说明。

## 2. Phase 依赖合理性

### 现有依赖判断

- `Phase 1 -> Phase 2`：合理。先冻结接口，再迁移本地核心逻辑。
- `Phase 1 -> Phase 3`：原则上合理，但前提是 **接口必须真的冻结**。当前接口尚未稳定，不适合并行。
- `Phase 4 依赖 Phase 2 + 3`：只对“搜索/上传/worker/MCP”成立；对“认证、项目 CRUD”来说过重。
- `Phase 5 依赖 Phase 4`：过于串行。前端完全可以在 API 契约冻结后并行推进页面骨架。
- `Phase 6 依赖 Phase 4 + 5`：对完整 smoke test 成立，但 Docker 基础设施其实可以更早推进。

### 更合理的拆分方式

1. **新增 Phase 0：契约冻结**
   - 冻结 `StorageAdapter`、元数据模型、服务端 API 契约。
   - 补齐共享契约测试，确保 Local/Cloud 两套实现行为一致。

2. **把 Phase 4 拆成 3 个子阶段**
   - 4A：认证、租户、项目 CRUD、基础 DB/Queue 启动。
   - 4B：上传、worker、真实索引流水线、SSE。
   - 4C：MCP HTTP、工具复用、云端搜索与 chunk 读取。

3. **允许 Phase 5 部分并行**
   - 登录/注册、布局、项目列表可以在 4A API 冻结后并行。
   - 搜索页在 4C API 冻结后再接入。
   - 设置页和成员管理要等 4A/4B 补齐对应接口。

4. **允许 Phase 6 分两段**
   - 6A：PostgreSQL/MinIO/迁移脚本/开发 compose，可在 Phase 3 后推进。
   - 6B：完整 server/worker/web 镜像与 smoke test，依赖 4B/4C/5。

## 3. 接口设计

### 3.1 `StorageAdapter` 与 Spec 已经漂移

- Spec 中的接口是：
  - `upsertChunks`
  - `upsertFile`
  - `writeArchive(dirPath, fileName, ...)`
  - `readContent/readMetadata/readSummaries`
- Phase 1 改成了：
  - `addDocuments`
  - `addFile`
  - `archive.write(fileId, { files })`
  - `read/readText/readBatch`
  - 额外增加 `MetadataAdapter`

这说明目前不是“按 Spec 实施”，而是“重新设计了一个新契约”。如果不先回写 Spec 或重新校准计划，Phase 2 和 Phase 3 会按不同理解推进。

### 3.2 现有 `VectorStore` API 没有被完整覆盖

现有 [`packages/search/src/vector-store/store.ts`](/Users/weidwonder/projects/agent_fs/packages/search/src/vector-store/store.ts) 实际公开的方法至少包括：

- `init`
- `addDocuments`
- `searchByContent`
- `getByChunkIds`
- `softDelete`
- `deleteByDirId`
- `deleteByDirIds`
- `deleteByFileId`
- `updateFilePaths`
- `compact`
- `countRows`
- `close`

Phase 1 的 `VectorStoreAdapter` 只覆盖了其中一部分，遗漏了：

- `softDelete`
- `updateFilePaths`
- `compact`
- `countRows`
- `searchByContent` 的 `filePathPrefix/includeDeleted/distanceType` 语义

影响判断：

- `softDelete/compact/countRows`：当前主要用于测试与维护，不一定阻塞主链路，但共享适配器测试会失去等价校验能力。
- `updateFilePaths`：如果未来云端支持目录移动/重命名，会直接缺口。
- `filePathPrefix`：当前本地 MCP 搜索在 scope 无法先解析成 `dirId` 时会回退到路径前缀过滤。Phase 2 若强行删除这一能力，必须先保证“所有 scope 都能稳定解析成 dirIds”。

### 3.3 `InvertedIndex` 与 `AFDStorage` 覆盖基本完整

对照现有实现：

- [`packages/search/src/inverted-index/inverted-index.ts`](/Users/weidwonder/projects/agent_fs/packages/search/src/inverted-index/inverted-index.ts)
- [`packages/storage/src/index.ts`](/Users/weidwonder/projects/agent_fs/packages/storage/src/index.ts)

`InvertedIndexAdapter` 与 `DocumentArchiveAdapter` 基本覆盖了真实 API，只是命名有变化，不构成主要阻塞。

### 3.4 `MetadataAdapter` 是必要的，但现在设计不完整

- Phase 1 引入 `MetadataAdapter`，这是正确方向，因为当前索引流水线强依赖 `index.json` 语义。
- 但计划同时在 Local/Cloud 工厂里都返回 `metadata: null as any`。
- 这等于把一个“必须先补齐的核心抽象”变成了未来债务，会在以下场景立刻暴露：
  - 目录树构建
  - 增量索引删除清理
  - 项目概况统计
  - `dir_tree` / `list_indexes` / `get_project_memory`
  - 云端 scope 解析

### 3.5 生命周期设计不一致

- LocalAdapter 需要调用 `vector.init()` / `invertedIndex.init()`。
- `createCloudAdapter()` 却看起来像“返回即就绪”，但实际上也需要 `vector.init()` 做 pgvector 类型注册。
- Phase 4 直接每个请求 `createCloudAdapter()`，但没有统一生命周期管理。

建议明确：

- `createXAdapter()` 只负责组装对象，不负责初始化。
- 新增统一的 `storage.init()` / `storage.close()`。
- 所有 server/worker 走单例依赖注入，避免每个请求反复初始化 DB/S3/Embedding。

### 3.6 Phase 之间导出面不自洽

Phase 4 直接依赖 `@agent-fs/storage-cloud` 导出：

- `getPool`
- `initDb`
- `putObject`
- `getObject`
- `initS3`

但 Phase 3 的 `src/index.ts` 草案并没有导出这些符号，只导出了 `createCloudAdapter` 和几个类。这会直接阻塞 Phase 4 开发。

## 4. 数据模型

### 合理点

- `users / tenants / tenant_members / projects / directories / files / chunks` 的主干结构基本合理。
- 让 `chunks`、`inverted_terms` 显式携带 `tenant_id`，在应用层过滤上更直接。
- `projects.config`、`tenants.config` 预留 JSONB 扩展位是对的。

### 主要问题与性能陷阱

1. **向量维度被写死为 `vector(1024)`**
   - 当前本地实现和测试里并不固定为 1024，现有流程常见是 384。
   - 一旦租户级 embedding 配置支持不同模型，这个 schema 会直接失效。
   - 这是高优先级设计问题。

2. **所谓“PostgreSQL FTS”并没有真正落到 `tsvector + GIN/GiST`**
   - Spec 写的是“应用层分词 + `tsvector`”。
   - Phase 3 实际方案是自建 `inverted_terms` 明细表，再在应用层算 BM25。
   - 这更接近“把 SQLite 倒排表搬到 Postgres”，不是 PG FTS。
   - 风险是：数据量上来后，搜索会变成大范围明细扫描 + 应用层聚合，内存和 CPU 都不稳。

3. **BM25 所需统计信息不完整**
   - 当前云端倒排设计没有稳定保存与复用 `doc_length` 等归一化信息，示例代码只能做近似打分。
   - 检索质量很可能与本地版发生明显偏差。

4. **缺少关键索引/约束**
   - `tenant_members(user_id)` 缺少索引，但登录/刷新流程频繁按 `user_id` 查 membership。
   - `directories(parent_dir_id)` 缺少索引，目录树扩展会退化。
   - `files(directory_id, name)` 缺少唯一约束，重复上传同名文件的行为不明确。
   - `files(status, tenant_id)`、`files(project_id 语义)` 相关查询缺乏更贴近业务的索引。

5. **租户删除的级联关系不干净**
   - 多个表上的 `tenant_id` 外键没有统一 `ON DELETE CASCADE`。
   - 即使当前没有删除租户 API，后续补上时也容易撞到约束错误。

6. **缺少审计与运维字段**
   - `files` 没有 `error_message / retry_count / updated_at`。
   - 对 worker 重试、失败回显、SSE 状态展示都不够。

7. **每租户共表 + 纯应用层过滤有性能与安全双重压力**
   - 现阶段可以先共表，但建议至少准备：
     - 统一 repository 层注入 tenant filter
     - 关键查询复合索引
     - 中长期评估 PostgreSQL RLS 或逻辑分片

## 5. 安全性

### 主要漏洞/薄弱点

1. **多租户登录模型不完整**
   - 用户可以属于多个租户，但登录/刷新逻辑只是“取第一条 membership”。
   - 没有“选择租户 / 切换租户”流程，也没有在 refresh token 中绑定 tenant。
   - 这会导致多租户产品语义不明确。

2. **Refresh Token 不可撤销、不可轮换**
   - 当前设计只是一个长期 JWT，没有服务端持久化、session 表、轮换或吊销机制。
   - 一旦泄漏，只能全局改密钥。

3. **RBAC 没有真正落地**
   - `tenant_members.role` 有 `owner/admin/member`，但项目、成员、配置操作没有基于角色的授权判断。
   - 后续“成员管理”一旦上线，会直接暴露权限空洞。

4. **租户隔离完全依赖应用代码自觉加 `tenant_id`**
   - 没有 DB 层 RLS，也没有统一 repository/DAO 封装。
   - 任何一次漏加过滤条件，都会变成跨租户数据泄露。

5. **配额没有执行**
   - `storage_quota_bytes` 只有字段，没有上传前/索引前校验。
   - 这既是资源隔离问题，也是 DoS 面风险。

6. **默认 JWT 密钥不安全**
   - `change-me-in-production` 这种默认值只适合本地开发，不应出现在生产默认路径里。

7. **上传缺少更严格的边界控制**
   - 当前只有体积限制，没有租户级限流、文件类型白名单、恶意文件处理策略。

## 6. 技术风险

### 风险最高的环节

1. **索引流水线云化**
   - 现有 [`packages/indexer/src/pipeline.ts`](/Users/weidwonder/projects/agent_fs/packages/indexer/src/pipeline.ts) 深度绑定目录路径、`.fs_index/index.json`、AFD 归档名。
   - 把它迁到云端，不只是换存储后端，还要重塑元数据读写方式。

2. **云端倒排检索方案**
   - 现在的设计在“SQLite 倒排”与“PostgreSQL FTS”之间摇摆，没有最终定案。
   - 必须先做 PoC，验证中文分词、BM25 质量、查询延迟与索引体积。

3. **Embedding 维度与租户配置**
   - 如果租户允许不同 embedding 模型，`chunks.content_vector` 维度和检索路径需要提前统一策略。
   - 否则 Phase 3 做完后 Phase 5/设置页一接入就返工。

4. **插件链路在 Linux Docker 中的可运行性**
   - PDF、DOCX、Excel、`.NET` 转换器、`nodejieba` 原生模块都需要尽早在容器中验证。
   - 这不是 Phase 6 才该发现的问题，应该在 Phase 3/4 前置验证。

5. **每请求创建 CloudAdapter / EmbeddingService**
   - 计划中的服务端实现会在请求路径上频繁初始化重资源对象。
   - 这会直接放大首字节延迟和资源泄漏风险。

### 建议前置验证的技术假设

1. 做一个 **CloudAdapter conformance test**：
   - 复用同一套测试同时验证 LocalAdapter 与 CloudAdapter。

2. 做一个 **中文检索 PoC**：
   - 比较 `inverted_terms + app BM25` 与 `tsvector` 方案的质量和性能。

3. 做一个 **真实 worker PoC**：
   - 从 S3 拉一个 PDF，跑完整插件转换、chunk、embedding、summary、写库，不要等到 Phase 4 正式开发时才串。

4. 做一个 **Docker 插件 PoC**：
   - 先验证 `nodejieba`、PDF 转换链、`.NET runtime` 在目标基础镜像上是否可用。

## 7. 遗漏与改进

### 必须补的改进

1. **新增“契约冻结”阶段**
   - 统一 Spec、Phase 1 和现有代码之间的适配器定义。
   - 明确 `metadata` 是否属于 `StorageAdapter` 的一部分。

2. **补齐 `CloudMetadataAdapter` 与目录/项目查询层**
   - 把 `index.json`/`Registry` 的云端等价物真正落在 `directories/files/projects` 上。
   - `dir_tree`、`list_indexes`、`get_chunk`、`get_project_memory` 全部依赖这层。

3. **为 server 增加统一服务层**
   - 不要在 route 里直接 new `CloudAdapter`、new `EmbeddingService`、手写 SQL。
   - 建议引入：
     - `AuthService`
     - `ProjectService`
     - `IndexingService`
     - `SearchService`
     - `McpToolService`

4. **补齐真实 worker 与事件机制**
   - job payload
   - 幂等处理
   - 重试/失败原因
   - SSE 广播
   - 文件状态机

5. **把 MCP 工具复用到同一业务层**
   - HTTP `/search` 和 MCP `search`
   - HTTP 上传/队列 与 MCP `index_documents`
   - `get_chunk` 不要复制第二套实现

6. **引入 API 契约与共享类型**
   - 前后端共享 DTO/Zod schema/OpenAPI，给 Phase 5 并行开发创造条件。

### 推荐的计划重排

1. Phase 0：契约冻结 + conformance tests
2. Phase 1：StorageAdapter + LocalAdapter + LocalMetadataAdapter
3. Phase 2：Refactor indexer/search/mcp/electron
4. Phase 3：Cloud schema + CloudAdapter + CloudMetadataAdapter + shared tests
5. Phase 4A：Auth/tenant/project CRUD
6. Phase 4B：Upload/worker/indexing/SSE
7. Phase 4C：Search + MCP tool parity
8. Phase 5：Web UI
9. Phase 6：Docker/部署

## 总体判断

如果以当前版本直接开工，最可能出现的结果是：

- Phase 1 和 Phase 3 各自实现出两套不完全兼容的 adapter。
- Phase 4 被迫边做边改前两阶段接口。
- Phase 5 因 API 不稳定无法顺利并行。
- 最后上线的是“能注册登录、能上传、但没有真实索引闭环和完整 MCP 工具”的半成品。

建议先做一次计划修订，把“接口冻结、元数据闭环、真实 worker、MCP parity”四件事前置，再进入实施。
