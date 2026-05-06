# harness-mcp

面向 AI 辅助开发的项目契约 MCP 服务器。

`harness-mcp` 把项目规则、业务规格、验证命令和质量约束通过 MCP 暴露给 AI 编码代理。它的目标不是替代测试框架，而是让 AI 在改代码前知道该读什么规则、该维护哪份业务契约、该运行哪类验证，以及验证结果是否真的覆盖了目标业务场景。

宿主项目仍然负责自己的运行时工具，例如 `mvn test`、`pytest`、`go test`、Cucumber、Playwright、Semgrep、ESLint、PMD 等。`harness-mcp` 负责选择契约、构造命令、调用宿主项目命令、解析报告，并检查报告是否覆盖被请求的 `.feature` 文件和场景。

## 项目状态

- 当前版本：`0.0.1`
- 运行时：Bun + TypeScript
- 分发方式：私有包
- 已实现报告解析：`cucumber-json`、`surefire-xml`
- 已纳入配置 Schema 但暂未实现解析：`pytest-json`

## 目录

- [解决什么问题](#解决什么问题)
- [从 0 接入一个项目](#从-0-接入一个项目)
- [安装与启动](#安装与启动)
- [连接 MCP 客户端](#连接-mcp-客户端)
- [项目目录约定](#项目目录约定)
- [配置说明](#配置说明)
- [工具说明](#工具说明)
- [Feature 编写规范](#feature-编写规范)
- [Constraint 编写规范](#constraint-编写规范)
- [本仓库开发](#本仓库开发)
- [设计边界](#设计边界)

## 解决什么问题

AI 编码代理在真实项目里常见的问题是：不了解项目约定、把需求留在聊天记录里、测试通过但没有覆盖目标业务、为了跑通流程引入低质量兜底代码。`harness-mcp` 把这些隐性要求沉淀成仓库内可读、可查、可验证的契约。

| 问题 | `harness-mcp` 的处理方式 |
|---|---|
| AI 不知道项目规则 | `context` 返回项目章程和能力索引 |
| 需求只存在于对话中 | `create_spec` / `update_spec` 把业务契约写入 `.feature` |
| 测试跑了但没覆盖目标业务 | `verify` / `flow` 检查 BDD 报告覆盖 |
| AI 新增临时兜底、调试输出等低质量代码 | `check` 执行配置的质量门禁或内置约束 |
| 工作区里有多个服务 | `ls` / `info` / `doctor` 展示接入情况和配置健康度 |

推荐开发闭环：

```text
读取项目规则 -> 读取或维护业务契约 -> 修改测试和代码 -> 验证业务行为 -> 检查质量约束
```

## 从 0 接入一个项目

下面假设你有一个新的宿主项目 `your-project`，希望 AI 后续在这个项目中按规则开发。

### 1. 创建 harness 目录

在宿主项目根目录创建：

```text
your-project/
├── harness.yaml
└── harness/
    ├── _charter/
    │   └── conventions.feature
    ├── constraints/
    │   └── no-low-quality-diff.feature
    ├── flows/
    │   └── smoke.feature
    └── <业务域>/
        └── <能力>.feature
```

各目录含义：

| 路径 | 作用 |
|---|---|
| `harness.yaml` | 项目的 harness 配置入口 |
| `harness/_charter/` | 项目章程：架构约定、编码规范、测试原则、AI 行为边界 |
| `harness/constraints/` | 质量约束：禁止新增的坏味道、跨层调用、硬编码密钥等 |
| `harness/flows/` | 端到端业务流程，例如下单、登录、支付 |
| `harness/<业务域>/` | 具体业务能力规格，例如 `order/create.feature` |

`_charter` 使用下划线是刻意设计：

- 表示这是保留目录，不是普通业务能力目录。
- 在文件树中通常会排在业务域之前，AI 和人都更容易先看到全局规则。
- 避免把 `charter` 误识别成一个业务域。
- 强调这里存的是项目治理规则，而不是某个功能点的验收场景。

### 2. 写最小配置

`harness.yaml` 至少需要：

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter
```

此时可以先让 MCP 客户端调用：

```text
help -> info -> doctor -> context
```

预期效果：

- `help` 能看到工具手册和推荐工作流。
- `info` 能看到项目是否被识别、目录是否存在、有哪些能力文件。
- `doctor` 能发现配置缺失、目录缺失、Feature 格式问题。
- `context` 会返回 AI 改代码前应该阅读的项目章程和能力索引。

### 3. 写项目章程

在 `harness/_charter/conventions.feature` 中写全局规则，例如：

```gherkin
# language: zh-CN
@charter

功能: 项目开发约定

  场景: AI 修改代码前必须先理解项目边界
    假设 AI 准备修改业务代码
    那么 应先阅读相关业务规格和约束
    而且 不应新增临时兜底逻辑掩盖失败
```

章程适合写“所有开发都要遵守”的规则，不适合写某个功能的具体验收条件。

### 4. 写业务能力规格

业务规格放在 `harness/<业务域>/<能力>.feature`。例如：

```gherkin
# language: zh-CN
# capability: order.create
@order

功能: 创建订单

  业务来源:
    - 用户提供: 创建订单需求

  意图:
    - 用户提交有效订单信息后，系统创建一笔可追踪订单。

  边界:
    - 本能力只负责创建订单，不负责支付。

  核心承诺:
    - 创建成功必须返回订单编号。
    - 库存不足必须显式失败，不能创建默认订单。

  风险:
    - AI 可能为了跑通流程忽略库存校验。

  待确认:
    - 无

  场景: 有库存时创建订单
    假设 用户提交有效订单信息
    当 创建订单
    那么 应返回订单编号
```

预期效果：

- AI 可以通过 `list_capabilities` 看见已有能力。
- AI 可以通过 `read_spec` 精确读取某个能力。
- 需求变化时，AI 应通过 `update_spec` 先更新规格，再改测试和代码。

### 5. 接入 BDD 验证

如果项目已有 Cucumber、behave、pytest-bdd、godog 或兼容 BDD runner，在 `harness.yaml` 配置 `bdd`：

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter

bdd:
  runner: cucumber-jvm
  cmd: "mvn test"
  workdir: "."
  feature_arg_pattern: '"{feature}"'
  name_filter_pattern: '-Dcucumber.filter.name="{name}"'
  report:
    format: cucumber-json
    path: target/cucumber.json
  timeout_ms: 600000
```

接入后：

- `verify` 会选择业务能力 `.feature` 并执行 BDD 命令。
- `flow` 会选择 `harness/flows/**/*.feature` 并执行 BDD 命令。
- 执行后会解析报告，确认目标 Feature 和目标 Scenario 真的出现在报告中。
- 如果命令成功但报告没有覆盖目标场景，仍然会失败。

### 6. 配置普通验证和质量检查

非 BDD 的普通验证放在 `commands.run`：

```yaml
commands:
  run:
    cmd: "npm test"
    workdir: "."
    timeout_ms: 300000
```

项目已有 lint、静态扫描或自定义质量门禁时，放在 `commands.check`：

```yaml
commands:
  check:
    cmd: "npm run lint"
    workdir: "."
    timeout_ms: 300000
```

如果未配置 `commands.check`，`check` 会使用内置约束执行器读取 `harness/constraints/**/*.feature`。

### 7. AI 实际开发时怎么用

新功能推荐流程：

```text
context -> create_spec -> 写测试 -> 实现代码 -> verify -> check
```

修改已有业务：

```text
context -> read_spec -> update_spec -> 更新测试和代码 -> verify -> check
```

不改变业务行为的重构：

```text
context -> 修改代码 -> run 或 verify -> check
```

最终效果是：AI 的开发过程不只停留在“代码能跑”，而是能被仓库内的业务规格、项目规则、测试报告和质量约束共同约束。

## 安装与启动

在 `harness-mcp` 仓库内执行：

```bash
bun install
bun run start
```

类型检查：

```bash
bun run typecheck
```

MCP Server 入口：

```text
src/index.ts
```

## 连接 MCP 客户端

Claude Code 配置示例：

```json
{
  "mcpServers": {
    "harness": {
      "command": "bun",
      "args": ["run", "/abs/path/to/harness-mcp/src/index.ts"],
      "env": {
        "HARNESS_PROJECT_ROOT": "/abs/path/to/your-project"
      }
    }
  }
}
```

`HARNESS_PROJECT_ROOT` 指向宿主项目根目录，也就是包含 `harness.yaml` 的项目。如果不设置该环境变量，`harness-mcp` 会使用 MCP Server 当前工作目录作为项目根目录。

## 项目目录约定

推荐目录：

```text
your-project/
├── harness.yaml
└── harness/
    ├── _charter/
    ├── constraints/
    ├── flows/
    └── <business-domain>/
```

规则：

- `spec_dir` 默认指向 `harness`。
- `charter_dir` 推荐指向 `harness/_charter`。
- `constraints` 和 `flows` 是约定目录。
- 普通业务能力建议按业务域拆分目录。
- `.feature` 是 AI 可读的业务契约，也是 BDD 验证的目标。

## 配置说明

### BDD 验证配置

`bdd` 配置供 `verify` 和 `flow` 使用。

```yaml
bdd:
  runner: cucumber-jvm
  cmd: "mvn test"
  workdir: "."
  feature_arg_pattern: '"{feature}"'
  name_filter_pattern: '-Dcucumber.filter.name="{name}"'
  report:
    format: cucumber-json
    path: target/cucumber.json
  timeout_ms: 600000
```

路径规则：

- `workdir` 是命令执行目录。
- `{feature}` 会渲染成相对 `workdir` 的路径。
- `report.path` 也相对 `workdir` 解析。

示例：如果 `workdir: "runner"`，目标文件是 `harness/order/create.feature`，实际传给 runner 的 feature 参数可能是 `../harness/order/create.feature`。

支持的 runner：

```text
cucumber-js | cucumber-jvm | behave | pytest-bdd | godog | custom
```

报告格式：

| 格式 | 状态 | 说明 |
|---|---|---|
| `cucumber-json` | 已实现 | 支持 Cucumber JS/JVM 及兼容 JSON 报告 |
| `surefire-xml` | 已实现 | 支持 Maven、Gradle、Jest JUnit 等常见 JUnit XML |
| `pytest-json` | Schema 已支持 | 暂未实现解析器 |

### 普通运行命令

`commands.run` 用于普通项目验证，不做 BDD 覆盖检查。

```yaml
commands:
  run:
    cmd: "npm test"
    workdir: "."
    report:
      format: cucumber-json
      path: reports/cucumber.json
    timeout_ms: 300000
```

### 质量检查命令

`commands.check` 用于宿主项目已有质量门禁的情况。

```yaml
commands:
  check:
    cmd: "npm run lint"
    workdir: "."
    timeout_ms: 300000
```

如果没有配置 `commands.check`，`check` 会使用内置约束执行器。

## 工具说明

| 工具 | 作用 | 典型使用时机 |
|---|---|---|
| `help` | 返回静态工具手册、推荐流程和示例 | 不确定该用哪个工具时 |
| `ls` | 扫描工作区下接入 harness 的项目 | 一个工作区包含多个服务时 |
| `info` | 汇总单个项目的配置、目录、能力、标签和 BDD 设置 | 接入后确认项目状态 |
| `doctor` | 诊断配置、目录、Feature 质量、约束和报告配置 | 新接入或验证失败时 |
| `context` | 返回项目章程、能力索引和 AI 使用提示 | AI 改代码前的第一步 |
| `list_capabilities` | 列出业务能力，可按标签或名称前缀过滤 | 选择要修改的业务能力时 |
| `search` | 搜索 harness `.feature` 文件，包含章程 | 不知道规则或能力在哪个文件时 |
| `read_spec` | 按能力名模糊读取单个业务规格 | 修改已有能力前 |
| `create_spec` | 创建新的业务能力 `.feature`，并做格式校验 | 新功能开发前 |
| `update_spec` | 替换已有业务能力 `.feature`，并做格式校验 | 需求变化时 |
| `verify` | 执行业务能力 `.feature` 对应的 BDD 验证，并检查报告覆盖 | 功能实现后 |
| `flow` | 列出或执行端到端流程 `.feature`，并检查报告覆盖 | 验证跨模块用户旅程时 |
| `run` | 执行 `commands.run`，用于普通验证命令 | 跑单测、集成测试或项目自定义验证 |
| `check` | 执行 `commands.check` 或内置约束规则 | 提交前检查质量约束 |

说明：本项目不提供 `ping` 工具。MCP 客户端能发现并调用这些工具，本身就说明 MCP 已连接；再提供 `ping` 不增加有效验证价值。

## Feature 编写规范

业务 Feature 是 AI 可读的业务契约，也是 BDD 验证目标。它不应该写成实现笔记。

必备元素：

- `# language: zh-CN`
- `# capability: <domain>.<capability>`
- 至少一个顶层标签，例如 `@order`
- `功能:` 或 `Feature:`
- 固定章节：`业务来源`、`意图`、`边界`、`核心承诺`、`风险`、`待确认`
- 至少一个 `场景:` 或 `Scenario:`

`业务来源` 至少应包含一种来源类型：

```text
PRD | 用户提供 | 人工确认 | 代码推断 | 现有测试
```

## Constraint 编写规范

约束文件位于：

```text
harness/constraints/**/*.feature
```

未配置 `commands.check` 时，内置执行器支持一组小型可执行 DSL。它不会解释任意自然语言。

示例：

```gherkin
# language: zh-CN
@constraint

功能: 本次修改不允许新增低质量代码

  场景: 本次 TypeScript 修改不应新增调试输出
    假设 扫描本次新增的 "src/**/*.ts" 行
    当 匹配到 "console\\.log"
    那么 应该报错 "本次修改新增了调试输出"
    而且 修正方式为 "删除调试输出；确需日志时使用项目统一 logger"
```

`扫描本次新增的` 会读取 `git diff HEAD` 中的新增行，并把未跟踪的新文件视为新增内容。

常见约束：

- 禁止新增硬编码密钥。
- 禁止新增临时 mock 或假数据兜底。
- 禁止新增调试输出。
- 禁止跨层直接调用。
- 禁止静默 fallback。
- 禁止宽泛捕获异常后吞掉错误。

## 本仓库开发

常用验证：

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-day21-surefire-xml.ts
bun run scripts/test-day22-bdd.ts
```

完整回归脚本位于 `scripts/`。

## 设计边界

`harness-mcp` 不做这些事：

- 不实现某种语言专属的测试框架。
- 不管理 Cucumber/BDD step definitions。
- 不替代宿主项目自己的构建、测试和部署系统。
- 不保存历史执行结果。
- 不强制 AI 必须按某个顺序调用工具。
- 不提供只证明 MCP 已连接的 `ping` 工具。

它提供的是契约层。真正的事实来源仍然是宿主项目中的需求、harness Feature、测试代码、验证命令和质量门禁。
