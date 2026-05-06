# harness-mcp 交接文档

> 给下一个 AI 看的:这个项目是什么、为什么做、参考了什么、目前进度、下一步。

---

## 一、项目愿景

做一个**语言无关的 AI 协作契约层 MCP**,给 AI 写代码套上两道护栏:

1. **项目宪法**(charter):分层、命名、异常、事务等约定 — 改任何代码前 AI 都得读
2. **业务规格**(capability):每个能力的 Gherkin 契约 + 示例 — 改实现前先改规格,改完跑测试看挂了什么

最终目标:让 AI 在大型项目里改代码不再"自由发挥",而是**按契约施工**。

### 三个真实痛点

| # | 痛点 | 工具回应 |
|---|---|---|
| P1 | AI 写代码无边界、不懂项目约定 | `context()` 一次性吐宪法 + 能力索引 |
| P2 | 文档↔ 代码不同步 | `update_spec` 引导"先改契约再改实现"(软强制) |
| P3 | 改完不知道挂了哪些业务语义 | `verify(capability?)` 跑外部测试 + 解析报告 + 自带 git diff |

---

## 二、参考项目

**HarnessX**: `/Users/fanzhijiong/Documents/local_dev/harnessx`(用户本地源码)

借鉴的设计:
- MCP server 注册多 tool 的结构(`harnessx/src/cli.ts` 的 `startMcpServer()`)
- context 命令的输入输出契约(`core/src/service/index.ts:524-667`)
- 模糊匹配:case-insensitive substring(已验证好用)
- 默认文本 vs `raw: true` JSON 双模式输出

**反向决定**(不抄的部分):
- ❌ 不读 `package.json`(绑死 TS),改读独立的 `harness.yaml` → 支持 Java/Python/Go
- ❌ 不内嵌 cucumber-js 执行,spawn 外部命令(`mvn` / `pytest` / `go test` 都行)
- ❌ 不做 5-tier 目录(instructions/methods/boundaries/...),只保留 `_charter/`、业务能力、`flows/`、`constraints/`
- ❌ 不做约束跨包继承(YAGNI)

---

## 三、要做什么

### MVP 核心工具(已完成)

| 工具 | 作用 |
|---|---|
| `check` | 跑项目约束检查 |
| `context` | 宪法全文 + 能力索引(AI 入口,改代码前必调) |
| `create_spec` | 安全创建新的业务规格文件 |
| `info` | 查看项目 harness 接入状态,不执行测试 |
| `doctor` | 静态自检 harness 接入问题,不执行测试 |
| `flow` | 列出或执行端到端用户旅程 `.feature`,并校验报告覆盖 |
| `list_capabilities` | 列能力,支持 `@tag` / 名字前缀过滤 |
| `ls` | 扫描工作区里哪些项目接入了 harness |
| `read_spec` | 读单个能力的 .feature 全文(模糊匹配,0/1/many 三种 UX) |
| `run` | 跑普通业务验证命令,解析报告 |
| `search` | 全文搜所有 .feature,带上下文 |
| `update_spec` | 整文件 rewrite,默认做 Gherkin 语法校验 |
| `verify` | 通过 `bdd` 配置执行 capability `.feature` + 解析报告 + 校验覆盖 + 可选 git diff |

### 不做的事

- ❌ 内置任何语言的 test runner — 项目自己有
- ❌ Step definition 管理 — cucumber-jvm/pytest-bdd 的事
- ❌ 持久化历史 — git log 已经做了
- ❌ Web UI / 鉴权 / 多租户

### v0.2 候选(只做实用闭环)

- `report`: 看历史运行结果。
- 常用报告解析器: Java/Python 常见 JUnit XML。

明确不做 `create_capability/delete_capability` 这类模板脚手架工具。AI 负责写完整 `.feature` 内容；`create_spec` 只做路径安全、去重、`# capability` 匹配和 Gherkin 校验后落盘。

---

## 四、关键约定

### `.feature` 文件格式

```gherkin
# language: zh-CN
# capability: subject-literacy.getByUid
# files: service/.../SubjectLiteracyApiServiceImpl.java:173-194
@subject-literacy

功能: 按知识图谱节点UID查询学科素养

  ## 规格(给 AI 读 — 不可执行)
  约束:
    - uid 是知识图谱节点 id,不是 examId
    - 软删除记录不返回

  ## 示例(可执行 — 测试用)
  场景: uid 下挂多条 — 全部返回
    假设 仓储返回 2 条记录
    当 调用 getByUid("node-001")
    那么 应返回 2 条
```

- `# capability:` = 唯一标识(read_spec / verify 用它定位)
- `# files:` = 关联代码(后续工具可用)
- `## 规格` / `## 示例` = Markdown header,Cucumber 当注释忽略

### 宿主项目接入

```
your-project/
├── harness.yaml             # 接入声明
└── harness/
    ├── _charter/            # 项目宪法,多文件
    │   ├── architecture.feature
    │   └── conventions.feature
    ├── flows/
    │   └── <用户旅程>.feature
    └── <业务域>/
        └── <能力>.feature
```

### `harness.yaml` 模板

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter

bdd:
  runner: cucumber-jvm
  cmd: "mvn -pl harness-runner test"
  workdir: "."
  feature_arg_pattern: '"{feature}"'
  name_filter_pattern: '-Dcucumber.filter.name="{name}"'
  report:
    format: cucumber-json
    path: harness-runner/target/cucumber.json
  timeout_ms: 600000

ai_hints: |
  - 改任何业务代码前先调 context
  - 改实现前先 update_spec
  - 改完调 verify 验证
```

---

## 五、目前进度(MVP 已完成)

### 项目位置
`/Users/fanzhijiong/Documents/cvte_project/harness-mcp/`

### 详细设计文档(完整 Plan)
**`/Users/fanzhijiong/.claude/plans/staged-whistling-lollipop.md`**(原始 plan)
副本: `/Users/fanzhijiong/Documents/cvte_project/harness-mcp/PLAN.md`

里面有完整的:工具签名、目录结构、harness.yaml 格式、.feature 模板、2 周 实现路径(Day 1 - Day 10)、验证方式。

### 已完成
- ✅ Day 1: 项目初始化 + Hello MCP
- ✅ Day 2: config.ts + capability.ts(扫目录解析能力)
- ✅ Day 3: context + list_capabilities
- ✅ Day 4: read_spec + search
- ✅ Day 6: update_spec + Gherkin 校验
- ✅ Day 7-8: verify + cucumber-json 解析 + git diff
- ✅ Day 21: surefire/JUnit XML 解析
- ✅ Day 10: README

### e2e 测试(全绿)
- `scripts/smoke.ts` — MCP 协议握手
- `scripts/test-day3.ts` — context / list_capabilities
- `scripts/test-day4.ts` — read_spec / search 6 个 case
- `scripts/test-day6.ts` — update_spec(合法/非法 Gherkin/歧义/未找到)
- `scripts/test-day7.ts` — verify(全过 / 失败带 capability / raw JSON)

### Fixture
`examples/sel-service-yaml/` — 完整接入示例(harness.yaml + 2 个 charter + 2 个能力 feature)

---

## 六、下一步建议

1. **真实联调**:把 `examples/sel-service-yaml/harness.yaml` 的 `cmd` 换成真实 `mvn ... test`,接到 Claude Code 跑端到端,验证 P1/P2/P3 是否真闭环
2. **接入 sel-service**:用户的实际 Java 项目在 `/Users/fanzhijiong/Documents/cvte_project/sel-service`,可以为它起草 charter + 1-2 个能力 feature
3. **v0.2 工具**:看用 1-2 周后的反馈,优先级高的再加
4. **多 report 格式**:目前支持 cucumber-json 和 surefire-xml,后续可以加 pytest-json

---

## 七、关键文件速查

| 文件 | 作用 |
|---|---|
| `src/server.ts` | 注册 6+1 个 tool |
| `src/config.ts` | harness.yaml schema + 加载 |
| `src/capability.ts` | 扫 .feature,解析 # capability: / # files: / @tag |
| `src/runner.ts` | runShell + applyTemplate |
| `src/git.ts` | captureGitDiff(64KB cap) |
| `src/parsers/cucumber-json.ts` | 状态优先级 failed > skipped > pending > passed |
| `src/parsers/surefire-xml.ts` | 解析 JUnit/Surefire XML,适配 jest-junit/Maven/Gradle 报告 |
| `src/gherkin.ts` | @cucumber/gherkin 解析校验(注意 IdGenerator 从 @cucumber/messages 导入,不是 gherkin) |
| `src/tools/*.ts` | 6 个工具实现 |

---

## 八、给下一个 AI 的提醒

- **用户偏好简洁**,响应别啰嗦,别加无关 cleanup
- **不要碰 sel-service 项目本身**(用户明说"暂时不需要管现有的 sel-service")
- **软强制就是软强制**,别在工具里硬拒 AI 不调 context 这种事 — 只在 prompt / 描述里提醒
- 测试 fixture 的命令是 `cp + echo` 拼出来的,改的时候注意 BDD 命令拼接逻辑(feature_arg_pattern/name_filter_pattern 会 append 到 bdd.cmd 后面)
