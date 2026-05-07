# harness-mcp

面向 AI 辅助开发的项目契约 MCP Server。

`harness-mcp` 把项目规则、业务规格、验证命令和质量约束暴露给 AI 编码代理。它不替代宿主项目的测试框架，只负责让 AI 找到正确的 `.feature` 契约、调用配置好的验证命令、解析报告，并确认验证结果覆盖了目标业务场景。

## 状态

- 版本：`0.0.1`
- 运行时：Bun + TypeScript
- 已实现报告解析：`cucumber-json`、`surefire-xml`
- Schema 已支持但暂未实现解析：`pytest-json`

## 安装

```bash
bun install
bun run start
```

类型检查：

```bash
bun run typecheck
```

MCP 入口：

```text
src/index.ts
```

## 连接 MCP 客户端

Claude Code 示例：

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

`HARNESS_PROJECT_ROOT` 指向宿主项目根目录，也就是包含 `harness.yaml` 的目录。不设置时使用 MCP Server 当前工作目录。

## 从 0 接入项目

### 1. 创建目录

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
    ├── capability-map.yaml
    └── features/
        └── <业务域>/
            └── <能力>.feature
```

目录说明：

| 路径 | 作用 |
|---|---|
| `harness.yaml` | harness 配置入口 |
| `harness/_charter/` | 项目章程：架构、编码、测试、AI 行为边界 |
| `harness/constraints/` | 质量约束 |
| `harness/flows/` | 端到端业务流程 |
| `harness/capability-map.yaml` | 业务能力地图 |
| `harness/features/<业务域>/` | 业务能力规格 |

`harness/` 只放契约文件，不放 BDD 执行代码。不要创建 `harness/bdd/steps`、`harness/steps`、`harness/cucumber.js` 这类目录或文件。

`_charter` 带下划线是为了标识保留目录，避免被当成普通业务域；同时在文件树中靠前，方便 AI 先读取全局规则。

### 2. 写配置

最小 `harness.yaml`：

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter
```

接入后先跑：

```text
help -> info -> doctor -> context
```

`doctor` 会检查 capability map、业务 feature 和 flow 是否对齐。

### 3. 写项目章程

`harness/_charter/conventions.feature` 示例：

```gherkin
# language: zh-CN
@charter

功能: 项目开发约定

  场景: AI 修改代码前读取项目规则
    假设 AI 准备修改业务代码
    那么 应先阅读相关业务规格和约束
    而且 不应新增临时兜底逻辑掩盖失败
```

章程写全局规则，不写单个功能的验收细节。

### 4. 写业务能力地图

先用 `update_map` 写入 `harness/capability-map.yaml`，固定业务域、能力边界、feature 路径和 flow uses。

```yaml
version: 1
domains:
  order:
    capabilities:
      - id: order.create
        file: features/order/create.feature
        intent: 用户提交有效订单信息后创建订单
      - id: order.cancel
        file: features/order/cancel.feature
        intent: 用户取消未完成订单
flows:
  - id: order.checkout
    file: flows/checkout.feature
    uses:
      - order.create
```

`create_spec` 只接受 map 中已声明且 `file` 一致的 capability。

### 5. 写业务规格

业务能力放在 `harness/features/<业务域>/<能力>.feature`：

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

写完或修改 feature 后，先做 `Feature Contract Review`，再写 BDD steps：

触发时机：

- `create_spec` / `update_spec` 写入 feature 后。
- 手动修改 `harness/**/*.feature` 后。
- `verify` / `flow` PASS 不触发 `Feature Contract Review`。

审查边界：

- 只审 feature 契约，不审 step 实现。
- 检查业务能力是否切对、场景是否是业务行为、`Then` 是否可验证、核心承诺是否被覆盖。

```text
| 检查项 | 结论 | 证据 | 处理 |
|---|---|---|---|
| 单一能力 | 通过/不通过 | feature 标题、边界、核心承诺 | 不通过则拆能力或改 map |
| 可验证 Then | 通过/不通过 | 每个 Then 的可观测结果 | 不通过则改 Then 或拆场景 |
| 承诺覆盖 | 通过/不通过 | 核心承诺与场景对应关系 | 缺失则补场景或写待确认 |
```

自检规则：

- `capability` 只表达一个业务能力。
- 场景描述业务行为，不写实现步骤。
- `Then` 必须是可验证的业务结果。
- 不要把 UI、API、DB、流程混在一个 `Then`。
- 每条核心承诺要被场景覆盖，不能覆盖的写入待确认。

### 6. 配置验证

BDD 验证配置供 `verify` 和 `flow` 使用：

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
- `{feature}` 渲染为相对 `workdir` 的路径。
- `report.path` 也相对 `workdir` 解析。

BDD step definitions、runner 配置和测试辅助代码写在宿主项目自己的测试目录里，不写在 `harness/` 里。例如：

```text
src/test/java/.../steps/
test/bdd/steps/
tests/bdd/
features/steps/
```

`harness/` 管“要验证什么”，宿主项目测试目录管“怎么验证”。`doctor` 会把 `harness/bdd/steps`、`harness/cucumber.js` 这类 BDD 执行实现标为错误。

Feature 和 step 必须做语义对齐。BDD runner 的 PASS 只说明 step 没抛错，不自动证明 `Then` 的业务语义。

`Step Evidence Review` 是 step 自审，也叫 Then-to-Assertion 自审。

触发时机：

- 写完或修改 BDD step definitions 后。
- `verify` / `flow` PASS 后，宣称 BDD 有效前。
- `create_spec` / `update_spec` 不直接触发它；那一步触发的是 `Feature Contract Review`。

审查边界：

- 只审 step 断言证据，不审 feature 划分。
- 检查实际断言是否证明了对应 `Then`。
- 如果不匹配，再决定改 feature 的 `Then`，或补同等级的 step 断言。

正确的 API Then：

```gherkin
场景: 上传 txt 文件并解析章节
  当 用户上传一个有效 txt 小说文件
  那么 系统返回章节解析结果，包含章节标题、顺序和字数
```

```js
Then("系统返回章节解析结果，包含章节标题、顺序和字数", function () {
  assert.ok(data.chapters.length > 0);
  assert.ok(data.chapters[0].title);
  assert.ok(data.chapters[0].order);
  assert.ok(data.chapters[0].wordCount);
});
```

正确的 UI Then：

```gherkin
场景: 上传 txt 文件并展示章节预览
  当 用户上传一个有效 txt 小说文件
  那么 右侧面板展示章节结构化预览
```

```js
Then("右侧面板展示章节结构化预览", async function () {
  await expect(page.getByTestId("chapter-preview-panel")).toBeVisible();
  await expect(page.getByText("第一章")).toBeVisible();
});
```

API 断言不能证明 UI 展示。发现 `Then` 和实际断言不一致时，只能二选一：改 `Then`，或补同等级的 step 断言。

自审表格式：

```text
| 场景 | Then 文本 | step 文件 | 实际断言 | 证据来源 | 是否匹配 | 处理 |
|---|---|---|---|---|---|---|
```

两类自审不要混用：

| 自审 | 触发 | 审查对象 | 不审什么 |
|---|---|---|---|
| `Feature Contract Review` | 写入或修改 feature 后 | feature 契约 | step 实现和测试证据 |
| `Step Evidence Review` | 写完 steps 后，或 `verify`/`flow` PASS 后 | step 断言证据 | feature 划分 |

支持的 runner：

```text
cucumber-js | cucumber-jvm | behave | pytest-bdd | godog | custom
```

普通验证命令：

```yaml
commands:
  run:
    cmd: "npm test"
    workdir: "."
    timeout_ms: 300000
```

质量检查命令：

```yaml
commands:
  check:
    cmd: "npm run lint"
    workdir: "."
    timeout_ms: 300000
```

未配置 `commands.check` 时，`check` 使用内置约束执行器读取 `harness/constraints/**/*.feature`。

## 推荐工作流

新功能：

```text
context -> update_map -> create_spec -> Feature Contract Review -> 写测试 -> 实现代码 -> verify -> check
```

修改已有业务：

```text
context -> read_spec -> update_spec -> Feature Contract Review -> 更新测试和代码 -> verify -> check
```

不改变业务行为的重构：

```text
context -> 修改代码 -> run 或 verify -> check
```

## 能力划分规则

- 一个业务 feature 只承诺一个可独立验证的业务结果。
- 同一能力的正常、异常、边界样例放在同一个 feature 的不同场景。
- 多个能力按顺序编排的用户旅程放在 `harness/flows/`。
- 如果一个 feature 场景过多、核心承诺过多，或标题像流程、全链路、端到端，先拆能力。
- `doctor` 会用 `capabilities.boundary` 提示结构过宽的业务 feature。

## 工具

| 工具 | 作用 |
|---|---|
| `help` | 查看工具手册、推荐流程和示例 |
| `ls` | 扫描工作区下已接入 harness 的项目 |
| `info` | 汇总项目配置、目录、能力、标签和 BDD 设置 |
| `doctor` | 检查配置、目录、Feature 质量、BDD 实现位置和报告配置 |
| `context` | 返回项目章程、能力索引和 AI 使用提示 |
| `list_capabilities` | 列出业务能力，支持按标签或前缀过滤 |
| `search` | 搜索 harness `.feature` 文件 |
| `read_spec` | 读取单个业务能力规格 |
| `update_map` | 创建或更新业务能力地图 |
| `create_spec` | 创建新的业务能力规格并校验格式 |
| `update_spec` | 更新已有业务能力规格并校验格式 |
| `verify` | 执行业务能力 BDD 验证并检查报告覆盖 |
| `flow` | 执行端到端流程 BDD 验证并检查报告覆盖 |
| `run` | 执行 `commands.run` |
| `check` | 执行 `commands.check` 或内置约束规则 |

## Feature 规范

业务 Feature 是业务契约，不是实现说明。

必备内容：

- `# language: zh-CN`
- `# capability: <domain>.<capability>`
- 至少一个顶层标签，例如 `@order`
- `功能:` 或 `Feature:`
- `业务来源`、`意图`、`边界`、`核心承诺`、`风险`、`待确认`
- 至少一个 `场景:` 或 `Scenario:`

`业务来源` 至少包含一种来源：

```text
PRD | 用户提供 | 人工确认 | 代码推断 | 现有测试
```

## Constraint 规范

约束文件位于：

```text
harness/constraints/**/*.feature
```

示例：

```gherkin
# language: zh-CN
@constraint

功能: 本次修改不允许新增低质量代码

  场景: TypeScript 修改不应新增调试输出
    假设 扫描本次新增的 "src/**/*.ts" 行
    当 匹配到 "console\\.log"
    那么 应该报错 "本次修改新增了调试输出"
    而且 修正方式为 "删除调试输出；确需日志时使用项目统一 logger"
```

`扫描本次新增的` 基于 `git diff HEAD`，未跟踪的新文件按新增内容处理。

## 本仓库开发

常用验证：

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-day21-surefire-xml.ts
bun run scripts/test-day22-bdd.ts
```

完整回归脚本位于 `scripts/`。

## 边界

`harness-mcp` 不实现语言专属测试框架，不管理 BDD step definitions，不替代宿主项目的构建、测试或部署系统。BDD step definitions 属于宿主项目测试代码，不属于 `harness/` 契约目录。
