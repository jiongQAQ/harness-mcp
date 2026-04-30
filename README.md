# harness-mcp

> 语言无关的 AI 协作契约层 MCP — 给 AI 写代码套上"项目宪法 + 业务规格"两道护栏。

## 解决什么问题

| 痛点 | 本工具的回应 |
|---|---|
| AI 写代码无边界、不懂项目约定 | `context()` 一次性吐出宪法 + 能力索引 |
| 规则写了但没人执行 | `check()` 可直接执行通用约束,也可接宿主项目检查命令 |
| 文档↔ 代码不同步 | `update_spec` 引导"先改契约,再改实现" |
| 改完不知道挂了哪些业务语义 | `verify(capability?)` 跑外部测试 + 解析报告 + 自带 git diff |

**和 HarnessX 的本质区别**:HarnessX 是绑死 TS/bun 的执行框架;本项目只做 AI 通信协议,执行甩给宿主项目自己的工具链(mvn/pytest/go test 都行)。

## 安装 / 启动

```bash
bun install
bun run src/index.ts          # stdio MCP server
```

接到 Claude Code (`~/.claude.json` 或项目级 `.mcp.json`):

```json
{
  "mcpServers": {
    "harness": {
      "command": "bun",
      "args": ["run", "/abs/path/to/harness-mcp/src/index.ts"],
      "env": { "HARNESS_PROJECT_ROOT": "/abs/path/to/your/project" }
    }
  }
}
```

`HARNESS_PROJECT_ROOT` 不传时回落到 `process.cwd()`。

## 工具(13 + 1)

| 工具 | 作用 |
|---|---|
| `check` | 执行项目约束检查;无 `commands.check` 时内置执行通用 lint constraints |
| `context` | 项目宪法全文 + 能力索引(AI 入口,改代码前必调) |
| `create_spec` | 安全创建新的业务规格文件,不生成模板 |
| `info` | 查看项目 harness 接入状态,不执行测试 |
| `doctor` | 静态自检 harness 接入问题,不执行测试 |
| `flow` | 列出或执行端到端用户旅程,支持 dryRun |
| `list_capabilities` | 列出能力,支持 `@tag` / 名字前缀过滤 |
| `ls` | 扫描工作区,发现已接入 `harness.yaml` 的项目 |
| `read_spec` | 读单个能力的 .feature 全文(模糊匹配) |
| `run` | 执行普通业务验证命令,解析报告并返回摘要 |
| `search` | 全文搜所有 .feature,带上下文 |
| `update_spec` | 整文件 rewrite,默认做 Gherkin 语法校验 |
| `verify` | spawn `harness.yaml.verify.cmd`,解析报告,带 git diff |
| `ping` | 健康检查 |

## 宿主项目接入

```
your-project/
├── harness.yaml            # 接入声明(见 examples/sel-service-yaml/)
└── harness/
    ├── _charter/           # 项目宪法,多文件
    │   ├── architecture.feature
    │   └── conventions.feature
    ├── constraints/        # 项目约束,给 check 执行
    │   └── no-broad-catch.feature
    └── <业务域>/
        └── <能力>.feature  # 一个能力 = 一个文件(规格 + 示例合并)
```

`harness.yaml` 模板:

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter

verify:
  cmd: "mvn -pl harness-runner test"
  workdir: "."
  filter_pattern: '-Dcucumber.filter.name="{capability}"'
  report:
    format: cucumber-json
    path: harness-runner/target/cucumber.json
  timeout_ms: 600000

commands:
  run:
    cmd: "mvn -pl harness-runner test"
    workdir: "."
    report:
      format: cucumber-json
      path: harness-runner/target/cucumber.json
    timeout_ms: 600000
  flow:
    cmd: "mvn -pl harness-runner test -Dgroups=flow"
    workdir: "."
    filter_pattern: '-Dcucumber.filter.name="{flow}"'
    report:
      format: cucumber-json
      path: harness-runner/target/flow-cucumber.json
    timeout_ms: 600000
  check:
    cmd: "mvn -pl harness-runner test -Dgroups=constraint"
    workdir: "."
    report:
      format: cucumber-json
      path: harness-runner/target/check-cucumber.json
    timeout_ms: 600000

ai_hints: |
  - 改任何业务代码前先调 context
  - 改实现前先 update_spec
  - 改完调 verify 验证
```

`commands.check` 是可选的。没配时,`check` 会直接执行 `harness/constraints/**/*.feature`
里的通用约束步骤;配了则把检查交给宿主项目命令,适合接 Cucumber/Semgrep/PMD/Checkstyle。
内置 diff 扫描会读取 `git diff HEAD` 的新增行,并把 untracked 新文件按新增内容处理。

## 内置 constraints 写法

diff-aware 规则用于限制本次修改,适合防止 AI 新增不符合项目风格的代码:

```gherkin
# language: zh-CN
@constraint
功能: 本次修改不允许新增低质量代码

  场景: 本次 Java 修改不应新增 catch Exception 或 Throwable
    假设 扫描本次新增的 "src/**/*.java" 行
    当 匹配到 "catch\\s*\\(\\s*(Exception|Throwable)\\b"
    那么 应该报错 "本次修改新增了宽泛 catch"
    而且 修正方式为 "捕获明确异常；确需边界兜底时要记录上下文并重新抛出或转换为业务异常"

  场景: 本次 Java 修改不应新增临时输出
    假设 扫描本次新增的 "src/**/*.java" 行
    当 匹配到 "System\\.out\\.println|printStackTrace\\(\\)"
    那么 应该报错 "本次修改新增了临时输出或堆栈打印"
    而且 修正方式为 "使用项目日志规范,或删除临时调试代码"
```

当前内置步骤:

- `假设 扫描 "<glob>"` / `Given scanning "<glob>"`
- `假设 扫描本次新增的 "<glob>" 行` / `Given scanning added lines in "<glob>"`
- `假设 扫描当前包的 "<ext>" 文件`
- `当 匹配到 "<regex>"` 或 ``当 匹配到 `<regex>` ``
- `那么 不应该有匹配`
- `那么 应该报错 "<message>"`
- `而且 修正方式为 "<fix>"`
- `那么 应该存在` / `那么 不应该存在`
- `当 运行命令 "<cmd>"` + `那么 命令应该成功`

## .feature 文件约定

```gherkin
# language: zh-CN
# capability: subject-literacy.getByUid
# files: service/.../SubjectLiteracyApiServiceImpl.java:173-194
@subject-literacy

功能: 按知识图谱节点UID查询学科素养
  ...
```

- `# capability:` — 唯一标识(read_spec / verify 用它定位)
- `# files:` — 关联代码,可选,给 AI 看
- 顶层 `@tag` — 给 list_capabilities 过滤用

## 开发

```bash
bun run scripts/smoke.ts        # MCP 协议握手
bun run scripts/test-day3.ts    # context / list_capabilities
bun run scripts/test-day4.ts    # read_spec / search
bun run scripts/test-day6.ts    # update_spec
bun run scripts/test-day7.ts    # verify
bun run scripts/test-day8-info.ts # info
bun run scripts/test-day9-doctor.ts # doctor
bun run scripts/test-day11-ls.ts # ls
bun run scripts/test-day12-run.ts # run
bun run scripts/test-day13-flow.ts # flow
bun run scripts/test-day14-check.ts # check
bun run scripts/test-day15-create-spec.ts # create_spec
bun run scripts/test-day16-check-builtin-lint.ts # check built-in constraints
bun run scripts/test-day17-check-diff-lint.ts # check git diff constraints
```

## 不做

- ❌ 内置任何语言的 test runner
- ❌ 内置复杂语言 AST 规则;这类规则请通过 `commands.check` 接 Semgrep/PMD/Checkstyle
- ❌ Step definition 管理
- ❌ 持久化历史 / Web UI / 鉴权
- ❌ 为了“看起来完整”增加模板脚手架;AI 负责写完整规格内容,MCP 只做安全创建和校验
