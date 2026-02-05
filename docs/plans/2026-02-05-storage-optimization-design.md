# 索引存储优化详细设计

> 文档版本: 1.0
> 创建日期: 2026-02-05
> 关联需求: req-change-260205

## 1. 概述

### 1.1 背景

当前 Agent FS 的索引存储方案存在以下问题：

1. **BM25 索引**：JSON 格式存储，包含完整文档文本，文件大、查询需全量加载
2. **文档存储**：每个文件一个文件夹，小文件多、inode 占用高
3. **向量库**：存储冗余文本（content、summary），体积大
4. **精准搜索**：无倒排索引，需遍历全部文档
5. **目录结构**：不支持递归索引子文件夹

### 1.2 优化目标

| 目标 | 预期效果 |
|------|---------|
| 精准搜索性能 | 倒排索引，O(1) 查询，支持目录过滤 |
| 存储空间 | AFD 压缩节省 60-80%，向量库减少 70-80% |
| 文件数量 | 文件夹 → 单个 .afd 文件，减少 inode |
| 读取性能 | Rust native 实现，首次 <10ms，缓存 <1ms |
| 层级索引 | Project 文件夹递归索引，搜索自动包含子文件夹 |

### 1.3 涉及模块

| 模块 | 改动类型 |
|------|---------|
| @agent-fs/storage | **新增**：Rust native AFD 存储 |
| @agent-fs/search | **重构**：BM25Index → InvertedIndex (SQLite) |
| @agent-fs/indexer | **修改**：适配新存储、支持层级索引 |
| @agent-fs/core | **修改**：类型定义调整 |
| plugins/* | **修改**：Excel 插件输出格式调整 |
| @agent-fs/mcp-server | **修改**：适配新存储和查询 |

---

## 2. 整体架构

### 2.1 存储架构对比

**优化前：**
```
~/.agent_fs/
├── storage/
│   ├── vectors/          # LanceDB (含 content/summary 文本)
│   └── bm25/
│       └── index.json    # 完整 JSON，包含所有文档文本

项目/.fs_index/
└── documents/
    ├── file1.pdf/
    │   └── content.md    # 每个文件一个文件夹
    └── file2.xlsx/
        └── content.md
```

**优化后：**
```
~/.agent_fs/
├── storage/
│   ├── vectors/                    # LanceDB (仅向量，无文本)
│   └── inverted-index/
│       └── inverted-index.db       # SQLite 倒排索引

项目/.fs_index/
├── index.json                      # 目录元数据 (含层级信息)
└── documents/
    ├── {fileId}.afd                # 压缩文件 (ZIP)
    └── {fileId}.afd
```

### 2.2 数据流架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       索引构建流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   原始文档                                                       │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────┐                                                   │
│   │ Plugin  │───► markdown (语义化视图)                         │
│   │         │───► searchableText (可选，结构化插件)              │
│   └────┬────┘                                                   │
│        │                                                        │
│        ▼                                                        │
│   ┌──────────────┐                                              │
│   │MarkdownChunker│───► chunks (基于 markdown 切分)             │
│   └──────┬───────┘                                              │
│          │                                                      │
│    ┌─────┴─────┬──────────────┬──────────────┐                  │
│    ▼           ▼              ▼              ▼                  │
│ ┌──────┐  ┌─────────┐  ┌───────────┐  ┌───────────┐            │
│ │ LLM  │  │Embedding│  │InvertedIdx│  │AFDStorage │            │
│ │Summary│  │ Service │  │ Builder   │  │           │            │
│ └──┬───┘  └────┬────┘  └─────┬─────┘  └─────┬─────┘            │
│    │           │             │              │                   │
│    ▼           ▼             ▼              ▼                   │
│ summary    向量化        倒排索引        .afd 文件              │
│    │           │             │              │                   │
│    └───────────┴──────┬──────┴──────────────┘                   │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │  存储层写入     │                                 │
│              ├────────────────┤                                 │
│              │ LanceDB        │ ← chunk 向量 + summary 向量     │
│              │ SQLite         │ ← 倒排索引 (文件级 BLOB)        │
│              │ .fs_index/     │ ← index.json + *.afd            │
│              └────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│                       搜索流程                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   用户查询 + 文件夹过滤                                          │
│       │                                                         │
│       ▼                                                         │
│   ┌───────────────┐                                             │
│   │DirectoryResolver│───► 展开子文件夹 (dir_id 列表)            │
│   └───────┬───────┘                                             │
│           │                                                     │
│     ┌─────┴─────┐                                               │
│     ▼           ▼                                               │
│ ┌────────┐  ┌──────────┐                                        │
│ │向量搜索 │  │倒排索引  │                                        │
│ │LanceDB │  │ SQLite   │                                        │
│ └───┬────┘  └────┬─────┘                                        │
│     │            │                                              │
│     └─────┬──────┘                                              │
│           ▼                                                     │
│   ┌───────────────┐                                             │
│   │  RRF 融合排序  │                                             │
│   └───────┬───────┘                                             │
│           │                                                     │
│           ▼                                                     │
│   ┌───────────────┐                                             │
│   │ AFDStorage    │───► 读取 chunk 内容 (从 .afd)               │
│   └───────┬───────┘                                             │
│           │                                                     │
│           ▼                                                     │
│      搜索结果                                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块详细设计

### 3.1 @agent-fs/storage (新增)

#### 3.1.1 职责

纯粹的 ZIP 压缩存储层，提供：
- 高效的 ZIP 压缩/解压
- LRU 缓存
- 批量并行读取

**不负责：**
- 内部文件结构定义（由上层决定）
- 业务逻辑

#### 3.1.2 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 语言 | Rust | 性能最优，内存安全 |
| Node 绑定 | napi-rs | 工具链成熟，跨平台编译简单 |
| ZIP 库 | zip-rs | Rust 生态标准库 |
| 零拷贝 | memmap2 | 避免大文件完全加载 |
| 并行 | rayon | 批量读取优化 |
| 缓存 | lru crate | 高效 LRU 实现 |
| 分发 | 预编译二进制 | 用户无需编译 |

#### 3.1.3 接口设计

```typescript
// packages/storage/src/index.ts

export interface StorageOptions {
  documentsDir: string;   // .fs_index/documents 路径
  cacheSize?: number;     // LRU 缓存大小，默认 100
}

export class AFDStorage {
  constructor(options: StorageOptions);

  /**
   * 写入文件到 AFD
   * @param fileId 文件标识符
   * @param files 文件内容映射 { "content.md": "...", "metadata.json": "..." }
   */
  write(fileId: string, files: Record<string, string | Buffer>): Promise<void>;

  /**
   * 从 AFD 读取文件（返回 Buffer）
   */
  read(fileId: string, filePath: string): Promise<Buffer>;

  /**
   * 从 AFD 读取文本文件
   */
  readText(fileId: string, filePath: string): Promise<string>;

  /**
   * 批量读取（并行）
   */
  readBatch(requests: ReadRequest[]): Promise<Buffer[]>;

  /**
   * 检查文件是否存在
   */
  exists(fileId: string): Promise<boolean>;

  /**
   * 删除文件
   */
  delete(fileId: string): Promise<void>;
}

export interface ReadRequest {
  fileId: string;
  filePath: string;
}

export function createAFDStorage(options: StorageOptions): AFDStorage;
```

#### 3.1.4 Rust 实现要点

```rust
// packages/storage/native/src/lib.rs

#[napi]
pub struct AFDStorage {
    documents_dir: PathBuf,
    cache: Arc<Mutex<LruCache<String, Arc<Vec<u8>>>>>,
}

#[napi]
impl AFDStorage {
    #[napi(constructor)]
    pub fn new(documents_dir: String, cache_size: Option<u32>) -> Self;

    #[napi]
    pub async fn write(
        &self,
        file_id: String,
        files: HashMap<String, Either<String, Buffer>>,
    ) -> Result<()>;

    #[napi]
    pub async fn read(&self, file_id: String, file_path: String) -> Result<Buffer>;

    #[napi]
    pub async fn read_text(&self, file_id: String, file_path: String) -> Result<String>;

    #[napi]
    pub async fn read_batch(&self, requests: Vec<ReadRequest>) -> Result<Vec<Buffer>>;

    #[napi]
    pub async fn exists(&self, file_id: String) -> Result<bool>;

    #[napi]
    pub async fn delete(&self, file_id: String) -> Result<()>;
}
```

**性能优化：**

1. **LRU 缓存**：缓存整个 ZIP 字节数据，后续读取跳过磁盘 I/O
2. **零拷贝 mmap**：大文件使用 mmap 避免完全加载
3. **并行读取**：使用 Rayon 并行处理批量请求
4. **压缩级别**：DEFLATE level 6（平衡压缩率和速度）

#### 3.1.5 预编译分发

支持平台：
- x86_64-apple-darwin (macOS Intel)
- aarch64-apple-darwin (macOS Apple Silicon)
- x86_64-pc-windows-msvc (Windows)
- x86_64-unknown-linux-gnu (Linux)
- aarch64-unknown-linux-gnu (Linux ARM)

---

### 3.2 倒排索引 (InvertedIndex)

#### 3.2.1 设计理念

- **SQLite 存储**：支持事务、索引、灵活查询
- **文件级 BLOB**：一个 term+file 对应一个 BLOB（平衡存储和查询）
- **目录过滤**：通过复合索引支持按 dir_id 过滤
- **增量更新**：按 file_id 删除/重建

#### 3.2.2 Schema 设计

```sql
-- 倒排索引主表
CREATE TABLE file_terms (
  term TEXT NOT NULL,           -- 词项（分词后）
  file_id TEXT NOT NULL,        -- 文件 ID
  dir_id TEXT NOT NULL,         -- 目录 ID（支持过滤）
  postings BLOB NOT NULL,       -- msgpack: [{chunk_id, locator, tf, positions}]
  tf_sum INTEGER NOT NULL,      -- 该词在该文件的总词频
  chunk_count INTEGER NOT NULL, -- 该词出现在几个 chunk
  PRIMARY KEY (term, file_id)
);

-- 按 term+dir 查询（最常用）
CREATE INDEX idx_term_dir ON file_terms(term, dir_id, tf_sum DESC);

-- 按 dir 删除（删除目录索引）
CREATE INDEX idx_dir ON file_terms(dir_id);

-- 按 file 删除（增量更新）
CREATE INDEX idx_file ON file_terms(file_id);
```

#### 3.2.3 Posting 结构

```typescript
// BLOB 内部结构（msgpack 序列化）
interface Posting {
  chunk_id: string;     // Chunk 标识符
  locator: string;      // 原文位置（Plugin 定义格式）
  tf: number;           // 词频
  positions: number[];  // 词在文本中的位置
}

// 一个 file_terms 记录的 postings 字段
type PostingList = Posting[];
```

#### 3.2.4 接口设计

```typescript
// packages/search/src/inverted-index/index.ts

export interface InvertedIndexOptions {
  dbPath: string;  // inverted-index.db 路径
}

export class InvertedIndex {
  constructor(options: InvertedIndexOptions);

  /**
   * 初始化（创建表、索引）
   */
  init(): Promise<void>;

  /**
   * 添加文件的索引
   */
  addFile(
    fileId: string,
    dirId: string,
    entries: IndexEntry[]
  ): Promise<void>;

  /**
   * 删除文件的索引
   */
  removeFile(fileId: string): Promise<void>;

  /**
   * 删除目录的所有索引
   */
  removeDirectory(dirId: string): Promise<void>;

  /**
   * 搜索
   */
  search(
    query: string,
    options?: InvertedSearchOptions
  ): Promise<InvertedSearchResult[]>;

  /**
   * 关闭连接
   */
  close(): Promise<void>;
}

export interface IndexEntry {
  text: string;         // 可搜索文本
  chunkId: string;      // 对应的 chunk ID
  locator: string;      // 原文位置
}

export interface InvertedSearchOptions {
  dirIds?: string[];    // 目录过滤（自动展开子目录）
  topK?: number;        // 返回数量
}

export interface InvertedSearchResult {
  chunkId: string;
  fileId: string;
  dirId: string;
  locator: string;
  score: number;        // TF-IDF 或 BM25 分数
}
```

#### 3.2.5 构建流程

```typescript
// 索引构建伪代码
async function buildInvertedIndex(
  fileId: string,
  dirId: string,
  chunks: Chunk[],
  searchableText: SearchableEntry[] | undefined,
  markdown: string
): Promise<void> {

  // 1. 建立 markdownLine → chunk 映射
  const lineToChunk = new Map<number, Chunk>();
  for (const chunk of chunks) {
    for (let line = chunk.lineStart; line <= chunk.lineEnd; line++) {
      lineToChunk.set(line, chunk);
    }
  }

  // 2. 确定要索引的文本
  const entriesToIndex: IndexEntry[] = [];

  if (searchableText && searchableText.length > 0) {
    // 结构化插件：使用 searchableText
    for (const entry of searchableText) {
      const chunk = lineToChunk.get(entry.markdownLine);
      if (chunk) {
        entriesToIndex.push({
          text: entry.text,
          chunkId: chunk.id,
          locator: entry.locator
        });
      }
    }
  } else {
    // 文本类插件：直接使用 markdown
    for (const chunk of chunks) {
      entriesToIndex.push({
        text: chunk.content,
        chunkId: chunk.id,
        locator: `lines:${chunk.lineStart}-${chunk.lineEnd}`
      });
    }
  }

  // 3. 写入倒排索引
  await invertedIndex.addFile(fileId, dirId, entriesToIndex);
}
```

---

### 3.3 向量库优化 (VectorStore)

#### 3.3.1 优化方案

**移除字段：**
- `content` (完整文本)
- `summary` (摘要文本)

**新增字段：**
- `file_id` (用于关联 AFD 文件)
- `chunk_line_start` (markdown 行范围起始)
- `chunk_line_end` (markdown 行范围结束)

#### 3.3.2 Schema 调整

```typescript
// 优化前
interface VectorDocument {
  chunk_id: string;
  file_id: string;
  dir_id: string;
  rel_path: string;
  file_path: string;
  content: string;          // ❌ 移除
  summary: string;          // ❌ 移除
  content_vector: number[];
  summary_vector: number[];
  locator: string;
  indexed_at: string;
  deleted_at: string;
}

// 优化后
interface VectorDocument {
  chunk_id: string;
  file_id: string;
  dir_id: string;
  rel_path: string;
  file_path: string;
  chunk_line_start: number; // ✅ 新增
  chunk_line_end: number;   // ✅ 新增
  content_vector: number[];
  summary_vector: number[];
  locator: string;
  indexed_at: string;
  deleted_at: string;
}
```

#### 3.3.3 读取 chunk 内容

```typescript
// 从 AFD 读取 chunk 内容
async function getChunkContent(
  storage: AFDStorage,
  fileId: string,
  lineStart: number,
  lineEnd: number
): Promise<string> {
  const markdown = await storage.readText(fileId, 'content.md');
  const lines = markdown.split('\n');
  return lines.slice(lineStart - 1, lineEnd).join('\n');
}
```

---

### 3.4 Plugin 架构调整

#### 3.4.1 接口变更

```typescript
// packages/core/src/types/plugin.ts

export interface DocumentPlugin {
  name: string;
  version: string;
  supportedExtensions: string[];

  /**
   * 转换文档
   */
  toMarkdown(filePath: string): Promise<PluginOutput>;

  /**
   * 解析 locator（用于跳转原文）
   */
  parseLocator(locatorStr: string): LocatorInfo;
}

export interface PluginOutput {
  /**
   * 语义化 Markdown（用于展示、向量化、chunk 切分）
   */
  markdown: string;

  /**
   * 可搜索文本（可选，结构化插件提供）
   * - 多个 entry 可以对应同一个 markdown 行
   * - 用于构建倒排索引
   * - 不持久化
   */
  searchableText?: SearchableEntry[];
}

export interface SearchableEntry {
  /**
   * 可搜索文本内容
   */
  text: string;

  /**
   * 对应 markdown 的行号（1-based）
   */
  markdownLine: number;

  /**
   * 原文位置标识符（Plugin 定义格式）
   * 例如：Excel → "Sheet1!A1:C100"
   *       PDF → "page:5"
   */
  locator: string;
}
```

#### 3.4.2 插件分类

**文本类插件（无需修改）：**
- Markdown Plugin
- PDF Plugin
- DOCX Plugin

输出示例：
```typescript
{
  markdown: "# 文档标题\n\n这是正文内容...",
  // searchableText 不提供，使用 markdown 构建倒排索引
}
```

**结构化插件（需要修改）：**
- Excel Plugin

输出示例：
```typescript
{
  markdown: `
## Sheet1: 销售数据表
表格区域 A1:C100，包含 100 条记录
主要字段：日期、产品、销售额
`,
  searchableText: [
    {
      text: "日期 产品 销售额 2023-01-01 产品A 100000 2023-01-02 产品B 85000",
      markdownLine: 2,
      locator: "Sheet1!A1:C100"
    },
    {
      text: "产品A 产品B 产品C",
      markdownLine: 2,
      locator: "Sheet1!B2:B100"
    }
  ]
}
```

---

### 3.5 层级索引

#### 3.5.1 概念定义

| 概念 | 说明 |
|------|------|
| Project | 顶级索引文件夹，是用户管理的单位 |
| 子文件夹 | Project 下的任意层级文件夹 |
| dirId | 每个文件夹的唯一标识符 (UUID) |
| projectId | Project 的 dirId，子文件夹也记录其所属 projectId |

#### 3.5.2 数据结构

**Registry（全局注册表）**

```typescript
// ~/.agent_fs/registry.json

interface Registry {
  version: string;
  embeddingModel: string;
  embeddingDimension: number;
  projects: RegisteredProject[];
}

interface RegisteredProject {
  path: string;                        // Project 文件夹绝对路径
  alias: string;                       // 别名
  projectId: string;                   // UUID
  summary: string;                     // Project 摘要
  lastUpdated: string;

  // 递归统计
  totalFileCount: number;
  totalChunkCount: number;

  // 子文件夹扁平化列表（便于搜索时展开）
  subdirectories: SubdirectoryRef[];

  valid: boolean;
}

interface SubdirectoryRef {
  relativePath: string;                // 相对于 Project 的路径
  dirId: string;                       // 子文件夹 UUID
  fileCount: number;
  chunkCount: number;
  lastUpdated: string;
}
```

**IndexMetadata（目录索引）**

```typescript
// .fs_index/index.json

interface IndexMetadata {
  version: string;
  createdAt: string;
  updatedAt: string;

  // 当前目录信息
  dirId: string;
  directoryPath: string;
  directorySummary: string;

  // 层级信息
  projectId: string;                   // 所属 Project ID
  relativePath: string;                // 相对于 Project 的路径（根为 "."）
  parentDirId: string | null;          // 父目录 ID（Project 为 null）

  // 统计
  stats: IndexStats;

  // 当前目录的文件
  files: FileMetadata[];

  // 直接子目录
  subdirectories: SubdirectoryInfo[];

  // 不支持的文件
  unsupportedFiles: string[];
}

interface FileMetadata {
  name: string;
  type: string;
  size: number;
  hash: string;                        // MD5 或 size:mtime
  fileId: string;
  indexedAt: string;
  chunkCount: number;
  summary: string;
  // 移除 chunkIds（从倒排索引查询）
}

interface SubdirectoryInfo {
  name: string;                        // 子目录名
  dirId: string;
  hasIndex: boolean;
  summary: string | null;
  fileCount: number;                   // 递归文件数
  lastUpdated: string | null;
}
```

#### 3.5.3 文件变更检测

```typescript
// packages/indexer/src/file-checker.ts

interface FileChangeResult {
  changed: boolean;
  hash: string;
}

async function checkFileChanged(
  filePath: string,
  oldMetadata: FileMetadata
): Promise<FileChangeResult> {
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
  const SIZE_THRESHOLD = 200 * 1024 * 1024; // 200MB

  if (fileSize > SIZE_THRESHOLD) {
    // 大文件：size + mtime
    const hash = `${fileSize}:${stats.mtime.getTime()}`;
    return {
      changed: hash !== oldMetadata.hash,
      hash
    };
  } else {
    // 小文件：MD5
    const content = await fs.readFile(filePath);
    const hash = createHash('md5').update(content).digest('hex');
    return {
      changed: hash !== oldMetadata.hash,
      hash
    };
  }
}
```

#### 3.5.4 搜索时目录展开

```typescript
// packages/search/src/directory-resolver.ts

class DirectoryResolver {
  constructor(private registry: Registry) {}

  /**
   * 展开目录 ID（包含所有子目录）
   */
  expandDirIds(dirIds: string[]): string[] {
    const result = new Set<string>(dirIds);

    for (const dirId of dirIds) {
      const project = this.findProjectContaining(dirId);
      if (!project) continue;

      // 如果是 Project ID
      if (dirId === project.projectId) {
        // 包含所有子目录
        project.subdirectories.forEach(sub => result.add(sub.dirId));
      } else {
        // 如果是子目录，找到其路径
        const subdir = project.subdirectories.find(s => s.dirId === dirId);
        if (subdir) {
          // 包含该路径下的所有子目录
          const prefix = subdir.relativePath + '/';
          project.subdirectories
            .filter(s => s.relativePath.startsWith(prefix))
            .forEach(s => result.add(s.dirId));
        }
      }
    }

    return Array.from(result);
  }

  private findProjectContaining(dirId: string): RegisteredProject | undefined {
    return this.registry.projects.find(p =>
      p.projectId === dirId ||
      p.subdirectories.some(s => s.dirId === dirId)
    );
  }
}
```

---

## 4. AFD 文件格式

### 4.1 格式定义

AFD (Agent File Description) 是 ZIP 格式的压缩文件，后缀名为 `.afd`。

**内部结构（由上层决定，storage 层不关心）：**

```
{fileId}.afd (ZIP)
├── content.md          # Markdown 内容（必需）
└── metadata.json       # 元数据（可选）
```

### 4.2 content.md 格式

由 Plugin 输出的 markdown 内容，不做任何修改。

### 4.3 metadata.json 格式

```json
{
  "sourceFile": "report.pdf",
  "sourceHash": "abc123...",
  "plugin": "pdf",
  "createdAt": "2026-02-05T10:00:00Z"
}
```

### 4.4 压缩参数

| 参数 | 值 |
|------|-----|
| 压缩算法 | DEFLATE |
| 压缩级别 | 6（平衡压缩率和速度） |
| 预期压缩率 | 60-80%（Markdown 文本） |

---

## 5. 性能设计

### 5.1 缓存策略

**AFD Storage 缓存：**
- LRU 缓存，默认容量 100
- 缓存整个 ZIP 字节数据
- 首次读取：磁盘 I/O + 解压
- 后续读取：直接从内存解压

**倒排索引：**
- SQLite 自身的页面缓存
- 查询结果不额外缓存（SQLite 已优化）

**向量库：**
- LanceDB 自身的缓存机制

### 5.2 并行处理

**批量读取 AFD：**
```rust
// Rayon 并行读取
requests.par_iter().map(|req| {
    self.read(req.file_id, req.file_path)
}).collect()
```

**索引构建：**
- 文件级并行（每个文件独立处理）
- Embedding 批量调用

### 5.3 性能指标

| 操作 | 目标 | 备注 |
|------|------|------|
| AFD 读取（cold） | < 10ms | 50KB 文件 |
| AFD 读取（cached） | < 1ms | 从内存解压 |
| 批量读取 100 文件 | < 700ms | 并行处理 |
| 倒排索引查询 | < 50ms | 1000 文件库 |
| 向量搜索 | < 100ms | 10K chunks |
| RRF 融合 | < 50ms | |

---

## 6. 错误处理

### 6.1 AFD Storage

| 错误类型 | 处理方式 |
|---------|---------|
| 文件不存在 | 抛出明确错误，上层处理 |
| 文件损坏（ZIP 格式错误） | 抛出错误，建议重建索引 |
| 内存不足 | 减小缓存大小，降级处理 |

### 6.2 倒排索引

| 错误类型 | 处理方式 |
|---------|---------|
| 数据库锁定 | 重试机制（3 次） |
| 磁盘空间不足 | 抛出错误，提示用户 |
| Schema 版本不匹配 | 自动迁移或提示重建 |

### 6.3 索引构建

| 错误类型 | 处理方式 |
|---------|---------|
| 单文件转换失败 | 记录错误，继续其他文件 |
| Embedding 服务不可用 | 重试或降级（跳过向量化） |
| 磁盘空间不足 | 停止索引，保留已完成部分 |

---

## 7. 兼容性考虑

### 7.1 数据迁移

本次为全新架构，不提供迁移工具。用户需要重新索引。

### 7.2 版本标识

| 组件 | 版本字段 |
|------|---------|
| Registry | `version: "2.0"` |
| IndexMetadata | `version: "2.0"` |
| 倒排索引 | 表中新增 `schema_version` |

### 7.3 向后兼容

旧版本数据无法直接使用，需要重新索引。启动时检测版本不匹配，提示用户重建。

---

## 8. 附录

### 8.1 包依赖关系

```
@agent-fs/indexer
    ├── @agent-fs/core
    ├── @agent-fs/storage     # 新增
    ├── @agent-fs/search
    │       ├── @agent-fs/core
    │       └── better-sqlite3  # 倒排索引
    ├── @agent-fs/llm
    │       └── @agent-fs/core
    └── plugins/*
            └── @agent-fs/core
```

### 8.2 新增依赖

| 包 | 用途 | 版本要求 |
|----|------|---------|
| better-sqlite3 | SQLite 绑定 | ^11.0.0 |
| msgpack | Posting list 序列化 | ^1.0.0 |
| @napi-rs/cli | Rust 编译工具（dev） | ^2.18.0 |

### 8.3 相关文档

- [需求文档](../requirements.md)
- [架构文档](../architecture.md)
- [Plugin 开发指南](../guides/plugin-development.md)
