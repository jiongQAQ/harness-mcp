# harness-mcp

> 语言无关的 AI 协作契约层 MCP — 给 AI 写代码套上"项目宪法 + 业务规格"两道护栏。

## 解决什么问题

| 痛点 | 本工具的回应 |
|---|---|
| AI 写代码无边界、不懂项目约定 | `context()` 一次性吐出宪法 + 能力索引 |
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

## 工具(6 + 1)

| 工具 | 作用 |
|---|---|
| `context` | 项目宪法全文 + 能力索引(AI 入口,改代码前必调) |
| `list_capabilities` | 列出能力,支持 `@tag` / 名字前缀过滤 |
| `read_spec` | 读单个能力的 .feature 全文(模糊匹配) |
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

ai_hints: |
  - 改任何业务代码前先调 context
  - 改实现前先 update_spec
  - 改完调 verify 验证
```

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
```

## 不做

- ❌ 内置任何语言的 test runner
- ❌ Step definition 管理
- ❌ 持久化历史 / Web UI / 鉴权
