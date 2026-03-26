# 全局 MCP 接入验证说明

> 用于在一个**全新会话**中验证 `agent-fs` 是否已通过全局配置接入，并确认 `search` 已返回 `keyword_snippets`。

## 1. 目的

验证以下两件事：

1. 全局配置中的 `agent-fs` MCP 已被新会话正确加载
2. `agent-fs` 的 `search` 工具在传入 `keyword` 时，会返回 `keyword_snippets`

## 2. 前置条件

- 已在全局 Codex 配置中加入：
  - `command = "/opt/homebrew/opt/node@22/bin/node"`
  - `args = ["/Users/weidwonder/projects/agent_fs/packages/mcp-server/dist/index.js"]`
- 已重新启动客户端或新建会话
- 知识库目录已建立索引：
  - `/Users/weidwonder/tasks/260205 审计知识库建立`

## 3. 验证范围

本次只验证：

- 全局 MCP 是否被会话注入
- `list_indexes` 是否能看到目标知识库
- `search` 是否能返回结果
- `search` 在关键词查询下是否返回 `keyword_snippets`

本次不验证：

- Electron app
- 本地脚本直调
- 手工启动 `stdio` 子进程

## 4. 通过标准

满足以下条件即可判定通过：

1. 新会话中能直接使用 `agent-fs` MCP，而不是退回到脚本方式
2. `list_indexes` 返回中包含路径 `/Users/weidwonder/tasks/260205 审计知识库建立`
3. 对 `金融工具减值` 发起 `search` 时：
   - 能返回结果
   - Top 结果中包含 `keyword_snippets`
   - `keyword_snippets` 至少有 1 条
   - `keyword_snippets[].text` 中包含“金融工具减值”或明显相关的减值上下文
4. 若 `keyword_snippets[].chunk_id` 不等于代表结果的 `chunk_id`，说明“被聚合刷掉的 chunk 快照回传”已生效

## 5. 推荐测试用例

### 用例 A：确认知识库已接入

- 调用 `list_indexes`
- 检查是否包含：
  - `path = /Users/weidwonder/tasks/260205 审计知识库建立`

### 用例 B：验证关键词快照

调用 `search`：

```json
{
  "query": "金融工具减值",
  "keyword": "金融工具减值",
  "scope": "/Users/weidwonder/tasks/260205 审计知识库建立",
  "top_k": 3
}
```

预期：

- `results[0].keyword_snippets` 存在
- `results[0].keyword_snippets.length >= 1`
- 至少一条快照来自同文件中的关键词命中 chunk

### 用例 C：验证税率类结果

调用 `search`：

```json
{
  "query": "企业所得税税率",
  "keyword": "企业所得税税率",
  "scope": "/Users/weidwonder/tasks/260205 审计知识库建立",
  "top_k": 3
}
```

预期：

- 返回 [企业所得税法-2018修正.pdf](/Users/weidwonder/tasks/260205%20审计知识库建立/税法体系/企业所得税法-2018修正.pdf) 相关结果
- 若有 `keyword_snippets`，片段应优先展示税率附近内容

## 6. 失败判定

出现以下任一情况，都应判定失败并明确指出失败层级：

1. 新会话里看不到 `agent-fs` MCP 工具
2. 只能通过脚本或本地 shell 间接访问，无法直接使用 MCP
3. `list_indexes` 看不到目标知识库
4. `search` 返回中没有 `keyword_snippets`
5. `keyword_snippets` 存在但内容与关键词无明显关系

## 7. 输出要求

新会话中的代理需要输出：

1. 是否确认“全局 MCP 已注入”
2. 使用了哪些 `agent-fs` 工具
3. 每个测试用例的实际返回要点
4. 是否通过
5. 若失败，失败在：
   - 全局工具注入层
   - MCP 协议层
   - `search` 业务逻辑层

## 8. 可直接粘贴的新会话 Prompt

下面这段可以直接发到新会话：

```text
请只使用当前会话里已经注入的全局 MCP 工具来验证 `agent-fs`，不要退回到本地脚本、shell 手工启动 stdio、也不要直接 import 仓库源码。

验证目标：
1. 确认全局 MCP 里是否已经接入 `agent-fs`
2. 对知识库 `/Users/weidwonder/tasks/260205 审计知识库建立` 跑一轮真实 MCP 测试
3. 重点验证 `search` 在传入 `keyword` 时是否返回 `keyword_snippets`

请按下面顺序执行：
1. 先检查当前会话里是否真的有可用的 `agent-fs` MCP 工具；如果没有，直接停止，并明确说明“全局 MCP 没有注入到本会话”
2. 如果有，先调用 `list_indexes`，确认目标知识库已存在
3. 调用 `search`：
   {
     "query": "金融工具减值",
     "keyword": "金融工具减值",
     "scope": "/Users/weidwonder/tasks/260205 审计知识库建立",
     "top_k": 3
   }
4. 检查返回结果里是否有 `keyword_snippets`
5. 如果有，再检查：
   - `keyword_snippets.length`
   - `keyword_snippets[0].chunk_id`
   - `keyword_snippets[0].locator`
   - `keyword_snippets[0].text`
   - 它是否和代表结果的 `chunk_id` 不同
6. 再补一个查询：
   {
     "query": "企业所得税税率",
     "keyword": "企业所得税税率",
     "scope": "/Users/weidwonder/tasks/260205 审计知识库建立",
     "top_k": 3
   }

输出要求：
- 先说是否确认“本会话已接入全局 agent-fs MCP”
- 再逐条报告测试结果
- 最后给出总判定：通过 / 不通过
- 如果不通过，明确是卡在“会话工具注入层”还是“agent-fs MCP 本身”
```
