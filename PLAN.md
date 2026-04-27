# harness-mcp 设计方案

## Context

用户想做一个**语言无关的 AI 协作契约层 MCP**,解决 3 个真实痛点:

| # | 痛点 | 本质 |
|---|---|---|
| **P1** | "怎么约束限制 AI" | AI 写代码无边界,需要项目"宪法"约束 |
| **P2** | "文档变动不及时,希望文档先行" | 文档↔代码不同步,需强制流程 |
| **P3** | "每次改动跑测试,知道哪些业务语义被破坏" | 测试要按业务语义组织 |

**完整工作流**:AI 改代码前读规格 → 改代码前先改规格 → 改完跑测试,坏一条业务立刻知道。

**和原版 HarnessX 的本质区别**:
- 原版是"框架"(执行+集成都管),绑死 TS/bun
- 本项目是"协议+适配器",**只管 AI 通信**,执行甩给宿主项目自己的工具链(mvn/pytest/go test)

**已确认的关键决策**:
- 项目位置: `~/Documents/cvte_project/harness-mcp/`
- 多语言通用,配置文件 `harness.yaml`(不绑 package.json)
- "文档先行"用**软强制**(prompt+工具描述指引,不硬拒绝)
- 规格和示例**先合并**到一个 `.feature` 文件,后续看效果再拆
- MVP **6 个工具**(F1/F2/F3/F4/F5/F8)
- 项目宪法用**多文件 `_charter/`** 目录组织
- verify 失败时**自动带上 git diff** 给 AI

---

## 功能集

### MVP(6 个工具)

| ID | 工具 | 解决 |
|---|---|---|
| F1 | `read_spec(capability)` | P1 — 读单个能力的 .feature 全文 |
| F2 | `list_capabilities()` | P1 — 列出所有能力 + 元数据 |
| F3 | `context()` | P1 — 项目宪法全文 + 能力索引(AI 入口) |
| F4 | `update_spec(capability, content)` | P2 — 修改 .feature(rewrite) |
| F5 | `verify(capability?)` | P3 — 跑外部测试,返回结构化结果 + git diff |
| F8 | `search(query)` | P1 — 跨所有 .feature 全文搜索 |

### v0.2(看反馈再加)

F6 `create_capability` / F7 `delete_capability` / F9 `diff_spec` / F10 `validate`

### 永远不做

- ❌ 内置任何语言的 test runner — 项目自己有
- ❌ Step definition 管理 — cucumber-jvm/pytest-bdd 的事
- ❌ 持久化历史 — git log 已经做了
- ❌ Web UI / 鉴权 / 多租户 / 多项目联邦 — YAGNI

---

## 工具详细规格

### F3 context() — 最重要的入口

**入参**: 无
**返回**:
```
project_charter:
  - 拼接 _charter/*.feature 全部内容
capabilities:
  - [{name, brief, file, tags, last_modified}]
usage_hints:
  - 从 harness.yaml 注入,告诉 AI 如何用其他工具
```
**用途**: AI 上来调一次,拿全局视图。

### F1 read_spec(capability)

**入参**: `capability` (模糊匹配,case-insensitive substring)
**返回**:
- 命中 1 个 → 该 .feature 全文
- 命中多个 → 候选列表,提示精确化
- 命中 0 个 → "未找到" + F2 输出

### F2 list_capabilities()

**入参**: `filter?` (可选 tag/前缀过滤)
**返回**: `[{capability, file, tags, files_linked, last_modified}]`

### F4 update_spec(capability, new_content)

**入参**: `capability`, `new_content` (完整文件内容)
**副作用**: 覆盖写文件
**返回**:
- 写入成功状态
- Gherkin 语法校验结果
- 提示: "如果改了规格,记得改对应实现并跑 verify"

### F5 verify(capability?)

**入参**: `capability` (可选,不传则跑全部)
**副作用**:
- spawn `harness.yaml.verify.cmd`(模板替换 `{capability}`)
- 解析 `harness.yaml.verify.report`
- 跑 `git diff HEAD` 拿当前未提交改动

**返回**:
```
exit_code: int
summary: { passed, failed, skipped, duration_ms }
failures: [
  { scenario, error_message, file_in_feature, line_in_feature }
]
git_diff: <patch text>      # 让 AI 看到刚改了什么
report_path: <full path>    # 供 AI 进一步读取
```

### F8 search(query)

**入参**: `query`
**返回**: `[{capability, file, matched_lines: [{line_no, text}]}]` (含匹配上下文)

---

## 项目结构(harness-mcp 自己)

```
~/Documents/cvte_project/harness-mcp/
├── package.json
├── tsconfig.json
├── README.md
├── bin/harness-mcp                    # #!/usr/bin/env bun
├── src/
│   ├── index.ts                       # CLI/MCP 启动
│   ├── server.ts                      # fastmcp 注册 tools
│   ├── config.ts                      # 加载 harness.yaml
│   ├── capability.ts                  # 能力发现/读取/修改
│   ├── runner.ts                      # spawn 外部测试命令
│   ├── git.ts                         # git diff 取改动
│   ├── parsers/
│   │   ├── cucumber-json.ts           # mvn/cucumber-jvm 输出
│   │   ├── surefire-xml.ts            # 备用
│   │   └── pytest-json.ts             # 后续
│   └── tools/
│       ├── context.ts
│       ├── read_spec.ts
│       ├── list_capabilities.ts
│       ├── update_spec.ts
│       ├── verify.ts
│       └── search.ts
└── examples/
    └── sel-service-yaml/
        └── harness.yaml
```

---

## 宿主项目接入结构

```
你的项目根/
├── harness.yaml                       # 接入声明
├── harness/
│   ├── _charter/                      # 项目宪法(多文件)
│   │   ├── architecture.feature       # 分层 / 包结构
│   │   ├── conventions.feature        # 命名 / 返回码 / 软删
│   │   ├── error-handling.feature     # 异常 / 错误码段
│   │   ├── transactions.feature       # 事务边界
│   │   └── ...                        # 项目自己加
│   └── <业务域>/
│       └── <能力>.feature             # 一个能力 = 一个文件(规格+示例)
└── (代码 / 测试,我们不管)
```

---

## `harness.yaml` 格式(MVP)

```yaml
version: 1
spec_dir: harness                      # 规格目录
charter_dir: harness/_charter          # 项目宪法目录(多文件)

verify:
  cmd: "mvn -pl harness-runner test"
  workdir: "."
  filter_pattern: '-Dcucumber.filter.name="{capability}"'   # 占位符替换
  report:
    format: cucumber-json
    path: harness-runner/target/cucumber.json

# 可选:写入 context() 返回的 usage_hints,引导 AI
ai_hints: |
  - 改任何业务代码前先调 context
  - 改实现前先 update_spec(软性提醒,不强制)
  - 改完调 verify 验证
```

---

## 单个 `.feature` 模板(规格 + 示例合并)

```gherkin
# language: zh-CN
# capability: subject-literacy.getByUid
# files: service/.../SubjectLiteracyApiServiceImpl.java:173-194
@subject-literacy

功能: 按知识图谱节点UID查询学科素养

  ## 规格(给 AI 读 — 不可执行)

  约束:
    - uid 是知识图谱节点 id,不是 examId
    - 一个 uid 下可挂多条素养,返回必须是列表
    - 软删除记录不返回

  AI 改代码必读:
    - 仓储 selectListByUid 已过滤软删
    - 异常需包装为 CodeBaseException

  ## 示例(可执行 — 测试用)

  场景: uid 下挂多条 — 全部返回
    假设 仓储返回 2 条记录
    当 调用 getByUid("node-001")
    那么 应返回 2 条
```

**约定**:
- `# capability:` 注释 = 唯一标识(F1/F4 通过它定位)
- `# files:` 注释 = 关联代码(后续 F12 可用)
- `## 规格` / `## 示例` 是 Markdown header(Cucumber 当注释忽略,人和 AI 能看清分层)

---

## 实现路径(2 周 MVP)

### Week 1 — 读 + 索引(P1 闭环)

| Day | 任务 |
|---|---|
| 1 | `bun init` + 装依赖(fastmcp/zod/yaml/@cucumber/gherkin) + Hello MCP 跑通 |
| 2 | `config.ts` 加载 harness.yaml + zod 校验 + `capability.ts` 扫目录 |
| 3 | F3 context + F2 list_capabilities |
| 4 | F1 read_spec(模糊匹配) + F8 search(全文 grep) |
| 5 | sel-service 联调 — 验证 P1: AI 调 context 后给的代码用对了术语和约定 |

### Week 2 — 写 + 验证(P2/P3 闭环)

| Day | 任务 |
|---|---|
| 6 | F4 update_spec + Gherkin 语法校验(`@cucumber/gherkin` 解析) |
| 7 | F5 verify — spawn mvn + 解析 cucumber.json |
| 8 | F5 加 `git diff` 输出 + 失败 scenario 映射回 .feature 行号 |
| 9 | sel-service 联调 — 验证 P3: 改代码 → verify → AI 看到挂的业务和 git diff |
| 10 | README + sel-service 接入示例 + harness.yaml 模板 |

---

## 验证方式(端到端)

**P1 验证(AI 约束)**:
1. sel-service 接入 harness-mcp
2. Claude Code 让 AI "改 SubjectLiteracy.getByUid 加 stage 过滤"
3. 观察 AI 自动调 `context` + `read_spec`
4. AI 给的代码使用 uid(非 examId)、遵守 charter 的事务/异常约定

**P2 验证(文档先行)**:
1. AI 改实现前应先调 `update_spec`
2. 不调也不拒绝(软强制),但工具描述里有提示
3. 观察长期使用率(第 2 周末统计 update_spec 调用次数 / 实现修改次数)

**P3 验证(业务语义测试)**:
1. AI 改完代码调 `verify(capability="subject-literacy.getByUid")`
2. harness-mcp spawn `mvn ... -Dcucumber.filter.name="按知识图谱节点UID查询学科素养"`
3. 解析 cucumber.json + git diff,返回:挂的场景 + 行号 + 刚改的代码
4. AI 自主决定回退或继续修

---

## 关键参考(HarnessX 源码)

- `core/src/service/index.ts:524-667` — context 命令的输入输出契约(我们的 F3 参考)
- `harnessx/src/cli.ts` 的 `startMcpServer()` — MCP server 怎么注册 tool

**继承的设计**:
- 模糊匹配算法:case-insensitive substring(已验证好用)
- 默认模式 vs raw 模式

**反向决定**:
- ❌ 不读 package.json,只读 harness.yaml
- ❌ 不内嵌 cucumber 执行,spawn 外部命令
- ❌ 不做 5 tier 目录,只有 charter + capabilities
- ❌ 不做约束跨包继承(YAGNI)
