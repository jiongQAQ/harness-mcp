# harness-mcp

`harness-mcp` 是一个给 AI 编程使用的 MCP Server。它把项目里的业务需求、项目约定、验证命令和代码质量约束暴露给 AI,让 AI 在改代码前先读懂业务,改完后能主动验证结果。

它不是测试框架,也不替代项目已有的 `mvn test`、`pytest`、`go test`、Cucumber、Playwright。它更像一层“AI 协作协议”:告诉 AI 该读什么、该改什么、该跑什么、什么代码不能乱写。

## 它解决什么

| 问题 | harness-mcp 怎么解决 |
|---|---|
| 第一次使用不知道从哪里开始 | `help` 静态解释 MCP 工具、推荐流程和中文 feature/check/flow 示例 |
| AI 不知道项目有哪些业务 | `context` / `list_capabilities` 给 AI 能力地图 |
| AI 改代码前不读业务规则 | `read_spec` 读取业务 feature 契约 |
| 新业务没有先定义需求 | `create_spec` 创建新的业务 feature |
| 业务变更没有先改文档 | `update_spec` 先改 feature,再改测试和代码 |
| feature 写得太浅 | 业务契约质量门禁会拦截缺段落、缺来源、缺场景 |
| AI 随便加兜底 try/catch、临时输出、硬编码 | `check` 执行约束,支持只检查本次 git diff 新增代码 |
| 改完不知道破坏了什么 | `verify` / `run` 调项目自己的测试命令并解析报告 |
| 一个目录下很多项目不知道谁接入了 | `ls` 扫描已接入 `harness.yaml` 的项目 |

核心流程:

```text
新增业务: PRD/需求 -> create_spec -> 写测试红 -> 写代码 -> verify/check
业务改动: read_spec -> update_spec -> 改测试红 -> 改代码 -> verify/check
纯重构: feature 不变 -> 改代码 -> verify/check
```

## 安装

```bash
bun install
bun run start
```

开发时可以跑:

```bash
bun run typecheck
```

## 接入 MCP 客户端

Claude Code 示例:

```json
{
  "mcpServers": {
    "harness": {
      "command": "bun",
      "args": ["run", "/abs/path/to/harness-mcp/src/index.ts"],
      "env": {
        "HARNESS_PROJECT_ROOT": "/abs/path/to/your/project"
      }
    }
  }
}
```

`HARNESS_PROJECT_ROOT` 指向要让 AI 操作的真实项目根目录。不传时使用 MCP Server 当前工作目录。

## 在真实项目里怎么开始

在你的项目根目录创建:

```text
your-project/
├── harness.yaml
└── harness/
    ├── _charter/
    │   └── conventions.feature
    ├── constraints/
    │   └── no-low-quality-diff.feature
    └── <业务域>/
        └── <业务能力>.feature
```

最小 `harness.yaml`:

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter
```

不要把 `spec_dir` 写成 `harness/specs` 这类 AI 自己发明的目录。`check` 默认扫描 `harness/constraints`，`flow` 默认扫描 `harness/flows`，业务 feature 放在 `harness/<业务域>` 下即可。

加上验证命令:

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter

verify:
  cmd: "mvn test"
  workdir: "."
  report:
    format: cucumber-json
    path: target/cucumber.json
  timeout_ms: 600000

ai_hints: |
  - 改业务代码前先调 context
  - 新增业务先 create_spec
  - 业务改动先 update_spec
  - 改完跑 verify 和 check
```

第一次测试建议按这个顺序:

```text
help -> info -> doctor -> context -> create_spec/read_spec -> verify -> check
```

## 目录说明

| 路径 | 作用 |
|---|---|
| `harness.yaml` | 项目接入配置 |
| `harness/_charter` | 项目宪法,例如架构分层、通用约定、业务红线 |
| `harness/<业务域>` | 业务能力 feature,会被当作 capability |
| `harness/constraints` | 约束检查,给 `check` 使用 |
| `harness/flows` | 端到端用户旅程,给 `flow` 使用 |

`constraints`、`flows`、`_charter` 不会被当成普通业务能力。

## 业务 Feature 怎么写

业务 feature 是 AI 改代码前必须读取的业务契约。它不是代码模块说明,也不是随便写几个场景。

所有 harness `.feature` 文件默认使用中文,文件头先写 `# language: zh-CN`。`create_spec` / `update_spec` 会拒绝业务 feature 缺少这个语言头;`doctor` 会提示 charter、constraints、flows 里的非业务 feature 是否漏写。

必须包含:

- `# language: zh-CN`
- `# capability: <业务域>.<能力名>`
- 顶层 `@tag`
- `功能:` 或 `Feature:`
- `业务来源`
- `意图`
- `边界`
- `核心承诺`
- `风险`
- `待确认`
- 至少一个 `场景:` 或 `Scenario:`

示例:

```gherkin
# language: zh-CN
# capability: answer.start
@answer

功能: 开始答题

  业务来源:
    - PRD: 用户提供的自主学答题流程需求

  意图:
    - 为学生创建或恢复一次可继续作答的答题轮次。

  边界:
    - 本能力定义开始答题的业务承诺,不规定具体代码类结构。

  核心承诺:
    - 开始答题必须返回可追踪的 practiceId。
    - 不支持的来源类型必须显式失败,不能默认兜底。

  风险:
    - AI 可能为了跑通而吞异常或返回默认轮次。

  待确认:
    - 无

  场景: 有效请求开始答题
    假设 学生具备开始答题所需上下文
    当 开始答题
    那么 应返回可继续作答的轮次
```

`业务来源` 必须写明来源类型之一:

- `PRD`
- `用户提供`
- `人工确认`
- `代码推断`
- `现有测试`

`create_spec` 和 `update_spec` 会拒绝缺少这些信息的 feature。`doctor` 会批量检查已有 feature。

## 约束 Check 怎么写

`check` 用来阻止 AI 本次修改新增低质量代码。它不是普通格式化工具,而是项目红线检查。

内置 `check` 不是自然语言推理器,只认识固定句式。不要把 constraint 写成“假设 AI 正在编写业务代码 / 那么 不得创建过早抽象”这种纯自然语言规则;`doctor` 和 `check(dryRun)` 会把它标成 `Unsupported constraint step`。

例如禁止本次新增宽泛兜底异常:

```gherkin
# language: zh-CN
@constraint
功能: 本次修改不允许新增低质量代码

  场景: 本次 Java 修改不应新增 catch Exception 或 Throwable
    假设 扫描本次新增的 "src/**/*.java" 行
    当 匹配到 "catch\\s*\\(\\s*(Exception|Throwable)\\b"
    那么 应该报错 "本次修改新增了宽泛 catch"
    而且 修正方式为 "捕获明确异常；确需兜底时写明原因并转换或重新抛出"
```

`扫描本次新增的` 会读取 `git diff HEAD` 的新增行,也会把 untracked 新文件当作新增内容。

如果项目已经有 Semgrep、PMD、Checkstyle、ESLint、架构测试等工具,可以把它们接到 `commands.check`。

## 工具清单

`help` 只介绍 MCP 怎么用,不读取当前项目、不总结当前项目。了解当前项目用 `context` / `info` / `doctor`,验证当前项目用 `verify` / `check` / `flow`。

| 工具 | 作用 |
|---|---|
| `help` | 查看 MCP 工具说明、推荐流程和中文示例 |
| `context` | AI 进入项目后读取项目宪法、能力索引和使用指引 |
| `info` | 查看当前项目是否正确接入 |
| `doctor` | 静态自检配置、目录、feature 质量和 verify 配置 |
| `ls` | 扫描工作区下的 harness 项目 |
| `list_capabilities` | 列出业务能力 |
| `search` | 搜索所有 feature |
| `read_spec` | 读取单个业务契约 |
| `create_spec` | 创建新业务 feature |
| `update_spec` | 修改已有业务 feature |
| `verify` | 执行 `harness.yaml.verify.cmd` 并解析报告 |
| `run` | 执行 `commands.run` |
| `flow` | 列出或执行 `harness/flows/**/*.feature` |
| `check` | 执行项目约束检查 |
| `ping` | 健康检查 |

## 常用命令

本仓库开发验证:

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-day18-feature-quality.ts
bun run scripts/test-day17-check-diff-lint.ts
```

完整脚本在 `scripts/` 目录。

## 设计边界

`harness-mcp` 只做三件事:

1. 让 AI 读到正确的业务契约和项目约定。
2. 让 AI 创建/修改 feature 时受到基础质量门禁约束。
3. 让 AI 调用宿主项目已有验证命令并拿到清晰结果。

真正的业务正确性仍然来自真实需求、feature 契约、测试用例和宿主项目自己的验证命令。
