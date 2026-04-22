---
date: '2026-04-22'
status: '概念设计阶段'
documentRole: 'architecture'
sourceOfTruth: './REQUIREMENTS.md'
---

# Knowledge Clue — 技术架构

> **文档治理说明**：本文档从属于 [REQUIREMENTS.md](./REQUIREMENTS.md)。若与 PRD 冲突，以 PRD 为准。

## 核心架构：三层分离

```
┌─────────────────────────────────────────────────┐
│           Index Layer (多种 Clue 视图)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │Timeline  │ │ Tag/Hash │ │   Tree   │  ...    │
│  │ Clue     │ │  Clue    │ │  Clue    │         │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘         │
├───────┼─────────────┼───────────┼────────────────┤
│       │   Link Layer (Segment 标注 + 引用)  │     │
│       ▼             ▼           ▼                │
├─────────────────────────────────────────────────┤
│         Content Layer (完整文档 + Segments)       │
│  [Doc-1: seg1, seg2, seg3]  [Doc-3: seg7, seg8] │
│  [Doc-2: seg4, seg5, seg6]                       │
└─────────────────────────────────────────────────┘
```

### Content Layer（内容层）

存储完整文档，不做物理切分。通过 LLM 在文档上标注语义段落（Segment），实现虚拟分段。

```yaml
Document:
  id: "doc-0001"
  content: "完整的 Markdown 原文"
  metadata:
    title: "OAuth2 Refresh Token 轮换策略"
    created_at: "2026-03-15"
    updated_at: "2026-04-10"
    author: "engineering-team"

Segment:
  id: "seg-0042"
  doc_id: "doc-0001"
  anchor_start: 120    # 字符偏移量
  anchor_end: 580
  semantic_summary: "refresh token 轮换的触发条件和时序"
  embedding: [0.012, -0.034, ...]  # vector
```

**设计决策**：采用"虚拟分段"而非硬切分 KU。
- 原始文档完整保留，Segment 只是标注层
- 文档更新时 Segment 标注可重新生成，不存在邻接链断裂问题
- 同一文档可被不同粒度的 Segment 标注覆盖

### Link Layer（链接层）

管理 Segment 之间以及 Segment 与 Clue 之间的关系。

```yaml
ClueEntry:
  clue_id: "clue-001"
  target:
    type: segment          # 或 segment_range
    segment_id: "seg-0042"
    # 范围引用时:
    # segment_ids: ["seg-0042", "seg-0043", "seg-0044"]
  position:
    # Timeline: timestamp 或 sequence
    # Tree: parent_entry_id + order
    # Hash: 仅关联关系，无位置
```

### Index Layer（索引层）

每种 Clue 是一个独立的索引视图。

```yaml
Clue:
  id: "clue-001"
  name: "Auth 系统演进"
  type: timeline
  description: "认证系统从 session 到 JWT 到 token 轮换的技术演进"
  entries: [...]  # ClueEntry 列表

Clue:
  id: "clue-002"
  name: "安全相关知识"
  type: hash
  tags:
    "认证": [ClueEntry, ...]
    "加密": [ClueEntry, ...]
    "RBAC": [ClueEntry, ...]

Clue:
  id: "clue-003"
  name: "系统架构"
  type: tree
  root:
    label: "平台架构"
    children:
      - label: "用户系统"
        entries: [ClueEntry, ...]
        children: [...]
```

#### Mixed Clue

Mixed 类型允许在单个 Clue 内混合使用不同组织模式：

```yaml
Clue:
  id: "clue-004"
  name: "项目全景"
  type: mixed
  structure:
    - type: tree
      label: "认证模块"
      children:
        - type: timeline        # 叶子节点变为时间线
          label: "方案演进"
          entries: [...]
    - type: hash
      label: "横切关注点"
      tags: { "性能": [...], "安全": [...] }
```

## 检索流程

```
用户查询
  ├─ 结构化导航（沿 Clue 浏览）
  │   └─ 命中 Segment → 拉取前后 Segment 恢复上下文 → 返回
  │
  ├─ 语义搜索（Embedding 相似度）
  │   └─ 命中 Segment → 拉取前后 Segment 恢复上下文 → 返回
  │
  └─ 混合检索
      └─ 两路结果合并排序 → 去重 → 返回
```

上下文恢复策略：命中 Segment 后，自动包含同一 Document 内相邻的 N 个 Segment（默认 N=2），确保阅读连贯性。

## 待决策项

- 存储选型：关系型（PostgreSQL + pgvector）vs 图数据库（Neo4j）vs 混合
- LLM Segment 标注的触发时机：导入时一次性 vs 后台异步 vs 按需
- Clue 自动生成的置信度阈值与人工审核流程
- 动态 Clue 的缓存策略（Phase 3）
