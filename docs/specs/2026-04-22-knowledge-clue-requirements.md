---
date: '2026-04-22'
status: '概念探索阶段'
documentRole: 'primary-prd'
sourceOfTruth: true
---

# Knowledge Clue — 产品需求文档

> **文档治理说明**：本文档是产品需求的唯一真相源。所有影响产品范围的变更必须先修改本文档。若与 ARCHITECTURE.md 冲突，以本文档为准。

## Executive Summary

Knowledge Clue 是一个多线索知识组织系统，解决传统 LLM Wiki 的核心痛点：**知识只能以单一固定的树形结构组织**。通过将内容与组织结构解耦，同一份知识可以通过多种"线索"（Clue）视角被检索和消费——时间线、标签散列、层级树形，或混合模式。结合 Embedding 语义搜索作为兜底，实现"结构化导航 + 语义发现"的双通道检索。

## Success Criteria

### User Success

| 指标 | 目标 |
|------|------|
| 知识检索命中率 | 用户通过任意 Clue 视角找到目标知识的成功率 > 90% |
| 上下文连贯性 | 检索结果保留足够上下文，用户无需额外跳转即可理解 > 85% 的情况 |
| Clue 创建成本 | 新增一种 Clue 视角的人工审核时间 < 30 分钟（LLM 自动生成 + 人工微调） |

### Technical Success

| 指标 | 目标 |
|------|------|
| 检索延迟 | Clue 导航 < 200ms，Embedding 搜索 < 500ms |
| 内容同步率 | Clue 索引与内容层一致性 > 99% |
| 增量更新 | 新增/修改一篇文档后，相关 Clue 自动更新时间 < 5 分钟 |

## Product Scope

### MVP（Phase 1）📋 计划中

- 📋 完整文档存储 + LLM 自动标注 Segment（虚拟分段，不破坏原始文档）
- 📋 Tree Clue 支持（与传统 wiki 等价的基线体验）
- 📋 Embedding 语义搜索兜底
- 📋 基础的文档导入能力

### Growth（Phase 2）📋 计划中

- 📋 Tag/Hash Clue（LLM 自动打标 + 人工审核）
- 📋 Timeline Clue（基于文档 metadata 自动生成）
- 📋 Clue 间交叉检索

### Vision（Phase 3）📋 计划中

- 📋 动态 Clue（用户自然语言定义视角，LLM 即时生成）
- 📋 Mixed Clue（树中嵌套时间线等混合结构）
- 📋 使用模式分析 → 高频临时 Clue 自动固化
- 📋 Clue 即 Prompt（每个 Clue 本质上是一个可执行的检索模板）

### Risk Mitigation

| 风险 | 缓解策略 |
|------|----------|
| KU 切分一致性 | 采用"虚拟分段"替代硬切分，保留完整文档 |
| Clue 维护成本指数增长 | LLM 自动生成 + 人工审核，而非纯手动构建 |
| 邻接链脆弱性 | 用 anchor 范围引用替代硬 prev/next 链接 |
| 冷启动困难 | Phase 1 与传统 wiki 等价，零学习成本切入 |

## User Journeys

### 新人小林的学习之旅

小林刚加入团队，需要理解认证系统的全貌。他打开 Knowledge Clue，选择"系统架构" Tree Clue，从顶层"平台架构"逐层展开到"用户系统 → 认证"，每一层都是连贯的文档段落而非碎片化的标签。他对 OAuth2 的部分特别感兴趣，切换到"Auth 演进" Timeline Clue，看到团队从 session → JWT → refresh token 轮换的完整技术决策脉络，每个节点都带着当时的设计考量。

### 老手阿强的精准定位

阿强需要快速找到所有和"token 过期"相关的知识。他不需要沿着树形结构一层层翻，直接在"安全相关" Hash Clue 里点击"认证"标签，3 个相关文档段落立即呈现。其中一个段落提到了一个他不知道的边界情况，他点击查看完整上下文——系统自动展开了该段落前后的内容，保持了阅读连贯性。

### PM 小张的全景概览

小张需要向管理层汇报技术演进。她选择"项目全景" Mixed Clue，顶层按模块分区（树形），点开"认证模块"后内部按时间线排列，清晰地展示了每次重大技术决策的时间、原因和影响。同一份底层知识，换一个视角就变成了管理层可消费的叙事。

## Functional Requirements

### 内容管理

- 支持 Markdown 文档导入和存储
- LLM 自动识别文档内语义段落边界，生成 Segment 标注
- Segment 标注不破坏原始文档完整性（虚拟分段）
- 支持对 Segment 生成 embedding vector

### Clue 系统

- 支持创建、编辑、删除 Clue
- Clue 类型：Tree / Timeline / Hash / Mixed
- Clue 条目可指向单个 Segment 或连续 Segment 范围
- LLM 辅助生成 Clue 条目（自动打标、自动排序、自动归类）
- Meta-Index：Clue 的索引，支持按领域或类型发现 Clue

### 检索

- 结构化导航：沿 Clue 结构浏览知识
- 语义搜索：基于 Embedding 的全文语义检索
- 上下文恢复：命中 Segment 时自动拉取前后 Segment 保持连贯性
- 两种检索结果可合并排序

## Non-functional Requirements

| 维度 | 要求 |
|------|------|
| 性能 | Clue 导航 < 200ms, 语义搜索 < 500ms |
| 可扩展性 | 支持 10,000+ 文档，100+ Clue |
| 可用性 | MVP 阶段的 Tree Clue 体验不低于 GitBook/Notion |
| 数据安全 | 支持私有部署，知识内容不外泄 |
