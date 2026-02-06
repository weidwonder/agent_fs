# 索引存储优化实施计划

> 文档版本: 1.1
> 创建日期: 2026-02-05
> 更新日期: 2026-02-06
> 关联设计: [storage-optimization-design.md](./2026-02-05-storage-optimization-design.md)

## 1. 实施概览

### 1.1 阶段划分

| 阶段 | 名称 | 核心交付 |
|------|------|---------|
| Phase A | 基础设施 | @agent-fs/storage (Rust native) |
| Phase B | 倒排索引 | InvertedIndex (SQLite) |
| Phase C | 向量库优化 | VectorStore schema 调整 |
| Phase D | 核心类型调整 | @agent-fs/core 类型更新 |
| Phase E | Indexer 重构 | 适配新存储、层级索引 |
| Phase F | Plugin 调整 | Excel 插件 searchableText 支持 |
| Phase G | MCP Server 适配 | 搜索和查询工具更新 |
| Phase H | 集成测试 | E2E 测试验证 |

### 1.2 依赖关系

```
Phase A (storage)
    │
    ├───────────────┬───────────────┐
    ▼               ▼               │
Phase B         Phase C             │
(inverted)      (vector)            │
    │               │               │
    └───────┬───────┘               │
            ▼                       │
        Phase D ◄───────────────────┘
        (core types)
            │
            ▼
        Phase E
        (indexer)
            │
    ┌───────┴───────┐
    ▼               ▼
Phase F         Phase G
(plugins)       (mcp-server)
    │               │
    └───────┬───────┘
            ▼
        Phase H
        (e2e test)
```

### 1.3 当前进展（截至 2026-02-06）

- ✅ 已完成：Phase A（核心能力，除 CI 多平台编译和性能基准）
- ✅ 已完成：Phase B（核心能力，除性能测试）
- ✅ 已完成：Phase C.1 / C.2 / C.3（向量 schema、VectorStore、单测）
- ✅ 已完成：Phase D（核心类型、Registry 结构、类型导出）
- ✅ 已完成：Phase E.2（接入 AFDStorage + InvertedIndex + 向量去文本）
- ✅ 已完成：Phase E.1 / E.3 / E.4（FileChecker、递归层级索引、Registry 扁平子目录）
- ✅ 已完成：Phase E.5 / E.6 / E.7（增量更新闭环、Indexer 单测、集成测试）
- ✅ 已完成：Phase F.1 / F.2 / F.3 / F.4 / F.5 / F.6（Excel 语义化输出、searchableText、适配与验证）
- ✅ 已完成：Phase G.1 / G.2 / G.3 / G.4 / G.5（`list_indexes`、`search`、`get_chunk`、`dir_tree`、对应单测）
- ✅ 已完成：Phase H.1 / H.2 / H.3 / H.4 / H.5（E2E 闭环 + 性能基准测试）

**已落地提交：**
- `eeeb8b3` feat(storage): 实现 AFD 原生读写并修复 arm64 构建
- `ff79ff7` feat(search): 新增 SQLite 倒排索引与目录解析能力
- `c05d44f` feat(indexer): 接入 AFD 存储与倒排索引主流程
- `4329ee7` feat(mcp-server): 接入 AFD 读取与倒排索引搜索

---

## 2. Phase A: @agent-fs/storage

### 2.1 目标

创建 Rust native 的 AFD 存储模块。

### 2.2 任务清单

- [x] **A.1** 初始化 packages/storage 目录结构
- [x] **A.2** 配置 Cargo.toml 和 napi-rs
- [ ] **A.3** 实现 Rust 核心功能
  - [x] A.3.1 ZIP 读写 (zip-rs)
  - [x] A.3.2 LRU 缓存
  - [ ] A.3.3 mmap 零拷贝
  - [x] A.3.4 并行读取 (Rayon)
- [x] **A.4** 实现 N-API 绑定
- [x] **A.5** TypeScript 包装层
- [x] **A.6** 单元测试
- [ ] **A.7** 配置 GitHub Actions 多平台编译
- [ ] **A.8** 性能基准测试

### 2.3 验收标准

| 指标 | 目标 |
|------|------|
| 读取 50KB（cold） | < 10ms |
| 读取 50KB（cached） | < 1ms |
| 批量读取 100 文件 | < 700ms |
| 压缩率 | 60-80% |
| 支持平台 | macOS(x64/arm64), Windows, Linux |

### 2.4 交付物

```
packages/storage/
├── package.json
├── Cargo.toml
├── src/
│   └── index.ts
├── native/
│   └── src/
│       ├── lib.rs
│       └── zip_ops.rs
└── __tests__/
    └── storage.test.ts
```

---

## 3. Phase B: 倒排索引

### 3.1 目标

实现 SQLite 倒排索引，替代原 BM25 JSON。

### 3.2 任务清单

- [x] **B.1** 设计 SQLite schema
- [x] **B.2** 实现 InvertedIndex 类
  - [x] B.2.1 初始化和迁移
  - [x] B.2.2 addFile() 方法
  - [x] B.2.3 removeFile() 方法
  - [x] B.2.4 removeDirectory() 方法
  - [x] B.2.5 search() 方法
- [x] **B.3** 实现 IndexEntryBuilder（分词 + 构建 posting）
- [x] **B.4** 实现 DirectoryResolver（目录展开）
- [x] **B.5** 单元测试
- [ ] **B.6** 性能测试

### 3.3 验收标准

| 指标 | 目标 |
|------|------|
| 单词查询（1000 文件） | < 50ms |
| 目录过滤查询 | < 50ms |
| 增量更新（删除+插入） | < 100ms/文件 |

### 3.4 交付物

```
packages/search/src/
├── inverted-index/
│   ├── index.ts
│   ├── inverted-index.ts
│   ├── index-builder.ts
│   ├── directory-resolver.ts
│   └── inverted-index.test.ts
└── index.ts  # 更新导出
```

---

## 4. Phase C: 向量库优化

### 4.1 目标

优化 VectorStore，移除冗余文本字段。

### 4.2 任务清单

- [x] **C.1** 更新 VectorDocument 类型
  - [x] 移除 content、summary 字段
  - [x] 新增 chunk_line_start、chunk_line_end 字段
- [x] **C.2** 更新 VectorStore 实现
  - [x] addDocuments() 适配新 schema
  - [x] searchByContent() 返回行范围
- [x] **C.3** 更新单元测试
- [ ] **C.4** 验证存储体积减少

### 4.3 验收标准

| 指标 | 目标 |
|------|------|
| 向量库体积 | 减少 70-80% |
| 搜索性能 | 不降级 |

### 4.4 交付物

```
packages/search/src/vector-store/
├── store.ts         # 更新
└── store.test.ts    # 更新

packages/core/src/types/
└── storage.ts       # 更新 VectorDocument
```

---

## 5. Phase D: 核心类型调整

### 5.1 目标

更新 @agent-fs/core 的类型定义。

### 5.2 任务清单

- [x] **D.1** 更新 Plugin 接口
  - [x] 新增 SearchableEntry 类型
  - [x] PluginOutput 新增 searchableText 字段
- [x] **D.2** 更新 IndexMetadata 类型
  - [x] 新增层级信息字段 (projectId, relativePath, parentDirId)
  - [x] FileMetadata 移除 chunkIds
  - [x] FileMetadata 新增 hash 字段
- [x] **D.3** 更新 Registry 类型
  - [x] 改名为 projects
  - [x] 新增 SubdirectoryRef
- [x] **D.4** 新增 Chunk 行范围信息
- [x] **D.5** 更新类型导出

### 5.3 交付物

```
packages/core/src/types/
├── plugin.ts        # 更新 PluginOutput, SearchableEntry
├── index-meta.ts    # 更新 IndexMetadata, FileMetadata, Registry
├── storage.ts       # 更新 VectorDocument
└── chunk.ts         # 更新 Chunk（新增行范围）
```

---

## 6. Phase E: Indexer 重构

### 6.1 目标

重构 Indexer，适配新存储架构和层级索引。

### 6.2 任务清单

- [x] **E.1** 实现 FileChecker（文件变更检测）
  - [x] MD5（≤200MB）
  - [x] size+mtime（>200MB）
- [x] **E.2** 重构 IndexPipeline
  - [x] 使用 AFDStorage 存储文档
  - [x] 使用 InvertedIndex 构建倒排索引
  - [x] 向量库移除文本存储
- [x] **E.3** 实现层级索引
  - [x] 递归索引子文件夹
  - [x] 维护 projectId、relativePath、parentDirId
- [x] **E.4** 更新 Registry 管理
  - [x] 只记录 Project
  - [x] 扁平化存储子文件夹引用
- [x] **E.5** 实现增量更新
  - [x] 检测文件变更
  - [x] 更新单个文件索引
- [x] **E.6** 单元测试
- [x] **E.7** 集成测试

### 6.3 验收标准

| 指标 | 目标 |
|------|------|
| 递归索引 | 正确索引所有子文件夹 |
| 增量更新 | 只更新变更文件 |
| Registry | 正确记录 Project 和子文件夹 |

### 6.4 交付物

```
packages/indexer/src/
├── file-checker.ts      # 新增
├── pipeline.ts          # 重构
├── indexer.ts           # 重构
└── __tests__/
    ├── file-checker.test.ts
    └── pipeline.test.ts
```

---

## 7. Phase F: Plugin 调整

### 7.1 目标

更新 Excel 插件，支持 searchableText 输出。

### 7.2 任务清单

- [x] **F.1** 设计 Excel 语义化 markdown 格式
- [x] **F.2** 实现 searchableText 生成
  - [x] 按区域组织可搜索文本
  - [x] 每个 entry 关联 markdown 行号
  - [x] 每个 entry 带 locator
- [x] **F.3** 更新 .NET 转换器输出格式
- [x] **F.4** 更新 TypeScript 适配层
- [x] **F.5** 单元测试
- [x] **F.6** 验证搜索准确性

### 7.3 验收标准

| 场景 | 预期 |
|------|------|
| Excel 语义化输出 | markdown 简洁、可读 |
| 搜索单元格内容 | 能找到对应 chunk |
| locator 精确 | 能定位到原文区域 |

### 7.4 交付物

```
packages/plugin-excel/
├── src/
│   ├── converter.ts     # 更新输出格式
│   └── index.ts
├── dotnet/
│   └── ExcelConverter/  # 更新 .NET 转换器
└── __tests__/
    └── excel-plugin.test.ts
```

---

## 8. Phase G: MCP Server 适配

### 8.1 目标

更新 MCP Server，适配新存储和查询。

### 8.2 任务清单

- [x] **G.1** 更新 list_indexes 工具
  - [x] 只返回 Project 列表
  - [x] 包含子文件夹树
- [x] **G.2** 更新 search 工具
  - [x] 支持多文件夹过滤
  - [x] 自动展开子文件夹
  - [x] 从 AFD 读取 chunk 内容
- [x] **G.3** 更新 get_chunk 工具
  - [x] 从 AFD 读取内容
- [x] **G.4** 更新 dir_tree 工具
  - [x] 支持层级目录结构
- [x] **G.5** 单元测试

### 8.3 交付物

```
packages/mcp-server/src/tools/
├── list-indexes.ts    # 更新
├── search.ts          # 更新
├── get-chunk.ts       # 更新
└── dir-tree.ts        # 更新
```

---

## 9. Phase H: 集成测试

### 9.1 目标

E2E 测试验证完整流程。

### 9.2 任务清单

- [x] **H.1** 完整索引流程测试
  - [x] 递归索引 Project
  - [x] 向量搜索验证
  - [x] 倒排索引搜索验证
  - [x] 融合搜索验证
- [x] **H.2** 增量更新测试
  - [x] 文件新增
  - [x] 文件删除
  - [x] 文件修改
- [x] **H.3** 层级搜索测试
  - [x] 搜索 Project
  - [x] 搜索子文件夹
  - [x] 多文件夹搜索
- [x] **H.4** MCP 工具测试
- [x] **H.5** 性能基准测试

### 9.3 验收标准

| 测试场景 | 预期结果 |
|---------|---------|
| 完整索引 | 所有文件正确索引 |
| 搜索准确性 | 向量+倒排融合正确 |
| 增量更新 | 只更新变更文件 |
| 性能指标 | 满足设计目标 |

### 9.4 交付物

```
packages/e2e/src/storage-optimization/
├── phase-h.e2e.ts            # H.1/H.2/H.3/H.4
└── phase-h-benchmark.e2e.ts  # H.5
```

### 9.5 性能基准结果（2026-02-06）

执行命令：

```bash
cd packages/e2e
pnpm exec vitest run src/storage-optimization/phase-h.e2e.ts src/storage-optimization/phase-h-benchmark.e2e.ts --config vitest.config.ts
```

实测结果（本地基线，96 文件）：

| 指标 | 实测值 | 设计目标 | 结论 |
|------|-------|---------|------|
| 完整索引耗时 | 691.526ms | 无硬阈值（记录基线） | ✅ 基线已记录 |
| 增量更新耗时 | 569.927ms（20 文件变更） | `<100ms/文件` | ✅ 28.496ms/文件 |
| 向量搜索平均耗时 | 41.014ms | `<100ms` | ✅ 达标 |
| 倒排搜索平均耗时 | 0.502ms | `<50ms` | ✅ 达标 |
| 融合（RRF）平均耗时 | 0.016ms | `<50ms` | ✅ 达标 |

---

## 10. 风险评估

### 10.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Rust 编译跨平台问题 | 某平台无法使用 | GitHub Actions 多平台 CI，提前验证 |
| SQLite 并发写入 | 索引构建冲突 | 使用事务，单写多读模式 |
| LanceDB schema 迁移 | 数据不兼容 | 新版本强制重建索引 |
| 大文件内存占用 | OOM | mmap + 流式处理 |

### 10.2 进度风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Rust 开发经验不足 | Phase A 延期 | 参考 napi-rs 示例，简化实现 |
| 测试覆盖不足 | 上线后问题 | 每个 Phase 包含测试任务 |

---

## 11. 检查点

### 11.1 Phase A 完成检查

- [ ] Rust 代码编译通过
- [ ] 多平台二进制生成
- [ ] 性能基准达标
- [ ] 单元测试通过

### 11.2 Phase B-D 完成检查

- [ ] 倒排索引功能完整
- [ ] 向量库 schema 更新
- [ ] 类型定义完整
- [ ] 现有测试适配通过

### 11.3 Phase E 完成检查

- [x] 递归索引功能正常
- [x] 增量更新功能正常
- [x] Registry 结构正确
- [x] 集成测试通过

### 11.4 Phase F-G 完成检查

- [x] Excel 插件输出正确
- [x] MCP 工具功能正常
- [x] 搜索结果准确

### 11.5 Phase H 完成检查

- [x] 所有 E2E 测试通过
- [x] 性能指标达标
- [x] 无回归问题

---

## 12. 附录

### 12.1 命令速查

```bash
# Phase A: Rust 编译
cd packages/storage
pnpm build              # 编译 release
pnpm build:debug        # 编译 debug
pnpm test               # 运行测试

# 运行全部测试
pnpm test --filter=@agent-fs/*

# 运行 E2E 测试
pnpm --filter=@agent-fs/e2e test
```

### 12.2 参考资源

- [napi-rs 文档](https://napi.rs/)
- [better-sqlite3 文档](https://github.com/WiseLibs/better-sqlite3)
- [LanceDB 文档](https://lancedb.github.io/lancedb/)
