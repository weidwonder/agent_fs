# 索引存储优化 Phase A/B 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 落地 AFD 存储（Rust + N-API）与 SQLite 倒排索引基础能力，提供可测试的读写与检索接口。

**Architecture:** 新增 `@agent-fs/storage` 负责 `.afd` ZIP 读写与缓存；在 `@agent-fs/search` 新增 `inverted-index` 模块，使用 SQLite + msgpack 实现文件级倒排索引，含 BM25 所需统计。

**Tech Stack:** TypeScript (ESM) + Vitest，Rust (napi-rs, zip, lru, memmap2, rayon)，SQLite (better-sqlite3), msgpack。

---

### Task 1: 创建 storage 包脚手架

**Files:**
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/src/index.ts`
- Modify: `tsconfig.json`

**Step 1: 创建 package.json（含 napi 构建脚本）**

```json
{
  "name": "@agent-fs/storage",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "index.node"],
  "scripts": {
    "build": "napi build --release",
    "build:debug": "napi build --debug",
    "clean": "rm -rf dist index.node",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {},
  "devDependencies": {
    "@napi-rs/cli": "^2.18.0",
    "typescript": "^5.3.0",
    "vitest": "^4.0.18"
  },
  "napi": {
    "name": "storage",
    "binary": {
      "module_name": "index",
      "package_name": "@agent-fs/storage",
      "targets": [
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-pc-windows-msvc",
        "x86_64-unknown-linux-gnu",
        "aarch64-unknown-linux-gnu"
      ]
    }
  }
}
```

**Step 2: 创建 tsconfig**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: 创建 TypeScript 入口（先导出类型占位）**

```ts
export interface StorageOptions {
  documentsDir: string;
  cacheSize?: number;
}

export interface ReadRequest {
  fileId: string;
  filePath: string;
}

export class AFDStorage {
  constructor(options: StorageOptions);
  write(fileId: string, files: Record<string, string | Buffer>): Promise<void>;
  read(fileId: string, filePath: string): Promise<Buffer>;
  readText(fileId: string, filePath: string): Promise<string>;
  readBatch(requests: ReadRequest[]): Promise<Buffer[]>;
  exists(fileId: string): Promise<boolean>;
  delete(fileId: string): Promise<void>;
}

export function createAFDStorage(options: StorageOptions): AFDStorage;
```

**Step 4: 更新根 tsconfig 引用**

在 `tsconfig.json` 的 `references` 里新增 `packages/storage`。

**Step 5: 提交**

```bash
git add packages/storage tsconfig.json
git commit -m "chore(storage): scaffold package"
```

---

### Task 2: storage 包测试（先失败）

**Files:**
- Create: `packages/storage/src/storage.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAFDStorage } from './index';

const makeTmp = () => mkdtempSync(join(tmpdir(), 'agent-fs-storage-'));

describe('AFDStorage', () => {
  it('write/read/readText/exists/delete', async () => {
    const dir = makeTmp();
    const storage = createAFDStorage({ documentsDir: dir, cacheSize: 10 });

    await storage.write('file1', {
      'content.md': '# 标题\n内容',
      'summaries.json': JSON.stringify({ c1: '摘要' })
    });

    expect(await storage.exists('file1')).toBe(true);

    const content = await storage.readText('file1', 'content.md');
    expect(content).toContain('标题');

    const buf = await storage.read('file1', 'summaries.json');
    expect(JSON.parse(buf.toString()).c1).toBe('摘要');

    await storage.delete('file1');
    expect(await storage.exists('file1')).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('readBatch', async () => {
    const dir = makeTmp();
    const storage = createAFDStorage({ documentsDir: dir });

    await storage.write('file1', { 'content.md': 'A' });
    await storage.write('file2', { 'content.md': 'B' });

    const results = await storage.readBatch([
      { fileId: 'file1', filePath: 'content.md' },
      { fileId: 'file2', filePath: 'content.md' }
    ]);

    expect(results.map((b) => b.toString())).toEqual(['A', 'B']);

    rmSync(dir, { recursive: true, force: true });
  });
});
```

**Step 2: 运行测试确认失败**

Run: `pnpm --filter @agent-fs/storage test`

Expected: FAIL（找不到 native 绑定或方法未实现）

**Step 3: 提交**

```bash
git add packages/storage/src/storage.test.ts
git commit -m "test(storage): add afd storage tests"
```

---

### Task 3: 初始化 Rust/N-API 绑定（使测试可运行）

**Files:**
- Create: `packages/storage/native/Cargo.toml`
- Create: `packages/storage/native/src/lib.rs`
- Modify: `packages/storage/src/index.ts`

**Step 1: 创建 Cargo.toml**

```toml
[package]
name = "agent_fs_storage"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["napi4", "serde-json"] }
napi-derive = "2"
zip = "2"
memmap2 = "0.9"
rayon = "1"
lru = "0.12"
parking_lot = "0.12"
```

**Step 2: 写 N-API 结构体占位（先返回 NotImplemented）**

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct AFDStorage {}

#[napi]
impl AFDStorage {
  #[napi(constructor)]
  pub fn new(_documents_dir: String, _cache_size: Option<u32>) -> Self {
    Self {}
  }

  #[napi]
  pub async fn write(&self, _file_id: String, _files: std::collections::HashMap<String, Either<String, Buffer>>) -> Result<()> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn read(&self, _file_id: String, _file_path: String) -> Result<Buffer> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn read_text(&self, _file_id: String, _file_path: String) -> Result<String> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn read_batch(&self, _requests: Vec<ReadRequest>) -> Result<Vec<Buffer>> {
    Err(Error::from_reason("NotImplemented"))
  }

  #[napi]
  pub async fn exists(&self, _file_id: String) -> Result<bool> {
    Ok(false)
  }

  #[napi]
  pub async fn delete(&self, _file_id: String) -> Result<()> {
    Ok(())
  }
}

#[napi(object)]
pub struct ReadRequest {
  pub file_id: String,
  pub file_path: String,
}
```

**Step 3: TS 入口改为加载 native**

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const native = require('../index.node') as {
  AFDStorage: new (documentsDir: string, cacheSize?: number) => AFDStorage;
};

export interface StorageOptions {
  documentsDir: string;
  cacheSize?: number;
}

export interface ReadRequest {
  fileId: string;
  filePath: string;
}

export class AFDStorage {
  private inner: InstanceType<typeof native.AFDStorage>;
  constructor(options: StorageOptions) {
    this.inner = new native.AFDStorage(options.documentsDir, options.cacheSize);
  }
  write(fileId: string, files: Record<string, string | Buffer>) {
    return this.inner.write(fileId, files);
  }
  read(fileId: string, filePath: string) {
    return this.inner.read(fileId, filePath);
  }
  readText(fileId: string, filePath: string) {
    return this.inner.read_text(fileId, filePath);
  }
  readBatch(requests: ReadRequest[]) {
    return this.inner.read_batch(requests.map((r) => ({
      file_id: r.fileId,
      file_path: r.filePath
    })));
  }
  exists(fileId: string) {
    return this.inner.exists(fileId);
  }
  delete(fileId: string) {
    return this.inner.delete(fileId);
  }
}

export function createAFDStorage(options: StorageOptions): AFDStorage {
  return new AFDStorage(options);
}
```

**Step 4: 运行测试确认仍失败（NotImplemented）**

Run: `pnpm --filter @agent-fs/storage build:debug && pnpm --filter @agent-fs/storage test`

Expected: FAIL（NotImplemented）

**Step 5: 提交**

```bash
git add packages/storage
git commit -m "chore(storage): add napi skeleton"
```

---

### Task 4: 实现 AFDStorage Rust 核心逻辑

**Files:**
- Modify: `packages/storage/native/src/lib.rs`

**Step 1: 实现文件路径与缓存结构**

```rust
#[napi]
pub struct AFDStorage {
  documents_dir: std::path::PathBuf,
  cache: std::sync::Arc<parking_lot::Mutex<lru::LruCache<String, std::sync::Arc<Vec<u8>>>>>,
}
```

**Step 2: 实现 write/read/read_text/exists/delete/read_batch**

- `write`: 在 `documents_dir` 写入 `{file_id}.afd`（zip），写入提供的 map。
- `read`: 读取 zip（缓存命中则直接解压内存字节）返回指定文件 Buffer。
- `read_text`: 基于 `read` 并 `String::from_utf8`。
- `read_batch`: rayon 并行 `read`。
- `exists`: 检查文件是否存在。
- `delete`: 删除文件。

**Step 3: 运行测试**

Run: `pnpm --filter @agent-fs/storage build:debug && pnpm --filter @agent-fs/storage test`

Expected: PASS

**Step 4: 提交**

```bash
git add packages/storage/native/src/lib.rs
git commit -m "feat(storage): implement afd read/write"
```

---

### Task 5: 引入倒排索引依赖与模块骨架

**Files:**
- Modify: `packages/search/package.json`
- Create: `packages/search/src/inverted-index/index.ts`
- Create: `packages/search/src/inverted-index/inverted-index.ts`
- Create: `packages/search/src/inverted-index/index-builder.ts`
- Create: `packages/search/src/inverted-index/directory-resolver.ts`
- Create: `packages/search/src/inverted-index/stopwords.txt`
- Modify: `packages/search/src/index.ts`

**Step 1: 添加依赖**

```json
"dependencies": {
  "@agent-fs/core": "workspace:*",
  "@lancedb/lancedb": "^0.23.0",
  "nodejieba": "^2.6.0",
  "better-sqlite3": "^11.0.0",
  "@msgpack/msgpack": "^3.0.0"
}
```

**Step 2: 建立模块导出**

`packages/search/src/inverted-index/index.ts`：导出 `InvertedIndex`、类型、`DirectoryResolver`、`IndexEntryBuilder`。

`packages/search/src/index.ts`：新增 `export * from './inverted-index';`。

**Step 3: 添加 stopwords.txt**

写入常见中英文停用词（可复用 bm25/tokenizer 内列表）。

**Step 4: 提交**

```bash
git add packages/search/package.json packages/search/src/inverted-index packages/search/src/index.ts
git commit -m "chore(search): scaffold inverted index module"
```

---

### Task 6: 倒排索引测试（先失败）

**Files:**
- Create: `packages/search/src/inverted-index/inverted-index.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { InvertedIndex } from './inverted-index';

const makeDb = () => mkdtempSync(join(tmpdir(), 'agent-fs-inv-'));

describe('InvertedIndex', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = makeDb();
    dbPath = join(dir, 'inverted-index.db');
  });

  it('add/search/remove', async () => {
    const index = new InvertedIndex({ dbPath });
    await index.init();

    await index.addFile('f1', 'd1', [
      { text: '你好 世界', chunkId: 'c1', locator: 'lines:1-1' }
    ]);

    const results = await index.search('世界', { dirIds: ['d1'], topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    await index.removeFile('f1');
    const results2 = await index.search('世界', { dirIds: ['d1'], topK: 10 });
    expect(results2.length).toBe(0);

    await index.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('directory filter', async () => {
    const index = new InvertedIndex({ dbPath });
    await index.init();

    await index.addFile('f1', 'd1', [{ text: 'alpha beta', chunkId: 'c1', locator: 'lines:1-1' }]);
    await index.addFile('f2', 'd2', [{ text: 'alpha beta', chunkId: 'c2', locator: 'lines:1-1' }]);

    const d1 = await index.search('alpha', { dirIds: ['d1'], topK: 10 });
    const d2 = await index.search('alpha', { dirIds: ['d2'], topK: 10 });

    expect(d1.every((r) => r.dirId === 'd1')).toBe(true);
    expect(d2.every((r) => r.dirId === 'd2')).toBe(true);

    await index.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

**Step 2: 运行测试确认失败**

Run: `pnpm --filter @agent-fs/search test -- packages/search/src/inverted-index/inverted-index.test.ts`

Expected: FAIL（实现缺失）

**Step 3: 提交**

```bash
git add packages/search/src/inverted-index/inverted-index.test.ts
git commit -m "test(search): add inverted index tests"
```

---

### Task 7: 实现 InvertedIndex（SQLite + BM25 统计）

**Files:**
- Modify: `packages/search/src/inverted-index/inverted-index.ts`

**Step 1: 实现 init + schema + WAL**

```ts
import Database from 'better-sqlite3';
import { encode, decode } from '@msgpack/msgpack';

export class InvertedIndex {
  private db: Database.Database;
  constructor(private options: { dbPath: string }) {
    this.db = new Database(options.dbPath);
  }
  async init() {
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS file_terms (...);
      CREATE TABLE IF NOT EXISTS index_stats (...);
      CREATE INDEX IF NOT EXISTS idx_term_dir ...;`);
  }
  // ...
}
```

**Step 2: 实现 addFile/removeFile/removeDirectory/updateStats/search**

- `addFile`: 对每个 entry 分词 → 生成 posting list（含 positions、tf）→ 写入 `file_terms`。
- 计算 `doc_length`（token 数）并写入。
- `updateStats`: 统计 `dir_id` 下文档数与平均长度。
- `search`: 按 term + dirIds 查询 postings，计算 BM25 分数，合并 chunk 级结果。

**Step 3: 运行测试**

Run: `pnpm --filter @agent-fs/search test -- packages/search/src/inverted-index/inverted-index.test.ts`

Expected: PASS

**Step 4: 提交**

```bash
git add packages/search/src/inverted-index/inverted-index.ts
git commit -m "feat(search): implement inverted index core"
```

---

### Task 8: IndexEntryBuilder + DirectoryResolver + 停用词

**Files:**
- Modify: `packages/search/src/inverted-index/index-builder.ts`
- Modify: `packages/search/src/inverted-index/directory-resolver.ts`
- Modify: `packages/search/src/inverted-index/stopwords.txt`
- Create: `packages/search/src/inverted-index/index-builder.test.ts`

**Step 1: IndexEntryBuilder 读取 stopwords.txt 并分词**

```ts
import nodejieba from 'nodejieba';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STOPWORDS = new Set(
  readFileSync(join(__dirname, 'stopwords.txt'), 'utf-8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
);

export function tokenize(text: string): string[] {
  const tokens = nodejieba.cutForSearch(text).map((t) => t.toLowerCase());
  return tokens.filter((t) => t && !STOPWORDS.has(t) && !/^[^\w\u4e00-\u9fa5]+$/.test(t));
}
```

**Step 2: DirectoryResolver 按 registry 展开 dirIds**

实现 `expandDirIds(dirIds: string[])`，逻辑与设计文档一致。

**Step 3: 写测试并运行**

Run: `pnpm --filter @agent-fs/search test -- packages/search/src/inverted-index/index-builder.test.ts`

Expected: PASS

**Step 4: 提交**

```bash
git add packages/search/src/inverted-index/index-builder.ts packages/search/src/inverted-index/directory-resolver.ts packages/search/src/inverted-index/stopwords.txt packages/search/src/inverted-index/index-builder.test.ts
git commit -m "feat(search): add index builder and directory resolver"
```

---

### Task 9: 全量回归（仅 search + storage）

**Step 1: 运行 storage tests**

Run: `pnpm --filter @agent-fs/storage test`

Expected: PASS

**Step 2: 运行 search tests**

Run: `pnpm --filter @agent-fs/search test`

Expected: PASS

**Step 3: 提交（如有遗漏修复）**

```bash
git add packages/storage packages/search
git commit -m "test: stabilize storage and inverted index"
```

---

**备注**
- 当前根 `package.json` 已新增 `pretest` 用于构建 `@agent-fs/core`，不要移除。
- Rust 构建依赖较多，若本机是 Rosetta x64，请优先使用 x64 依赖；如切换 arm64 终端需重新 `pnpm install`。
