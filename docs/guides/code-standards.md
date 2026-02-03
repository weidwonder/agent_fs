# 代码规范

> 适用于 Agent FS 全仓库（packages/*）。

## 目标

- 统一代码风格与命名，降低跨模块协作成本
- 保证类型、配置与运行时行为一致，避免隐性错配
- 以测试和验证为准，减少回归

## 语言与注释

- 沟通、文档、代码注释全部使用中文。
- 注释只解释“为什么/约束/边界”，避免描述显而易见的实现。

## 命名与结构

- 文件名：全小写 + 连字符（如 `code-standards.md`）。
- 变量/函数/类：使用 camelCase / PascalCase。
- 配置键：统一使用 snake_case（与 YAML/JSON 文件一致）。
- 类型字段：与配置键保持一致，不做 camelCase 转换。

## 配置与类型一致性（强制）

- `config.yaml` 中的字段必须与 `packages/core/src/config/schema.ts` 和 `packages/core/src/types/config.ts` 完全一致。
- 禁止在类型层使用 camelCase（如 `baseUrl`），配置层使用 snake_case（如 `base_url`）的混合写法。
- 若新增配置：同步更新
  - 配置 schema
  - 配置类型
  - 相关单元测试（含新增字段）

## 依赖管理

- `package.json` 中每个字段只能出现一次（禁止重复 `dependencies`/`devDependencies`）。
- 公共依赖放根目录，模块私有依赖放对应包。
- 模块包内依赖必须完整声明，不能依赖 hoist 偶然可用。

## TypeScript 规范

- 保持 `strict`，禁止引入 `any` 逃逸（确有需要需注释说明）。
- 对外导出的类型必须从 `@agent-fs/core` 统一出口导出。
- 类型变更必须同步测试用例（至少覆盖字段存在性和关键结构）。

## 测试与验证

- 修复与变更遵循 TDD：先写失败测试，再实现。
- 单测使用 Vitest，测试文件放在 `packages/**/src/**/*.test.ts`。
- 声称完成前必须运行：
  - `pnpm test`
  - 需要构建验证时：`pnpm build`

## 格式化与静态检查

- 统一使用 ESLint/Prettier，不在代码里手动覆盖格式规则。
- 提交前建议执行 `pnpm lint`。

## 变更同步

- 改动配置、类型或关键行为时，需同步更新相关文档与测试。
- 新增/删除核心能力时，更新 `docs/requirements.md` 或对应设计文档。
