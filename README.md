# harness-mcp

`harness-mcp` 是面向 AI 协作开发的业务契约治理层。它让 AI 在写代码前先讲清业务依据，交付前再用来源、契约、BDD 报告和治理检查证明没有偏离业务。

它不是测试框架，也不接管 step definitions。宿主项目继续使用自己的 Cucumber、Playwright、JUnit、pytest 等测试体系；`harness-mcp` 只负责业务契约、验证调度和交付治理。

## 它解决什么问题

- 需求散落在 PRD、会议、聊天和代码里，AI 不知道哪个才是业务事实。
- AI 容易跳过业务梳理直接改代码，最后“能跑但业务错”。
- 旧项目业务逻辑藏在 Controller、Service、SQL 和测试里，缺少可审查的业务说明。
- BDD 容易只证明接口能调通，不能证明业务规则被保护。
- 前端、后端、第三方服务、E2E 各自命名，同一个业务能力对不齐。
- 需求变更后，很难知道影响了哪些能力、规则、场景和测试。

## 核心流程

`harness-mcp` 的工作方式是先沉淀业务事实，再生成业务契约，最后用测试报告和治理检查证明实现没有偏离契约。

```text
业务来源 -> 业务发现 -> 人工确认 -> 契约落地 -> 测试和实现 -> 验证 -> 治理检查
```

对应到工具链：

```text
read_source/read_contract -> discover -> contract -> verify -> lint -> check
```

其中 `Feature Contract Review` 用来审 feature 是否表达了正确业务规则；`Step Evidence Review` 用来审 step definitions 的断言是否真的证明了 Then。

## 接入方式

新项目从 0 接入：

1. 使用 `guide` 查看新项目接入流程。
2. 使用 `init` 创建最小 `harness.yaml` 和 `harness/` 骨架。
3. 使用 `project_context` 确认目录、章程、来源、能力地图和 AI 指引。
4. 先沉淀第一份业务来源，再进入 `discover`。

旧项目补业务契约：

1. 使用 `guide` 查看旧项目补契约流程。
2. 使用 `init` 创建兼容旧项目的 harness 骨架。
3. 从真实入口方法、调用链、SQL、现有测试中推导业务来源。
4. 使用 `discover` 输出业务规则、状态变化、副作用、例子、证据和待确认问题。
5. 人工确认后，再用 `contract` 写入能力地图和 feature。

日常新增或修改业务：

1. 先读取已有来源和契约，确认本次影响范围。
2. 用 `discover` 做业务发现，不直接写 feature。
3. 业务边界确认后，用 `contract` 更新契约。
4. 写实现和 BDD step definitions。
5. 用 `verify`、`lint`、`check` 做交付前验证。

## 工具边界

| 工具 | 作用 |
|---|---|
| `guide` | 按任务场景告诉 AI 下一步怎么做；不读取项目 |
| `init` | 创建最小 harness 骨架；不生成业务 feature |
| `project_context` | 读取章程、来源索引、能力地图、已有契约和 AI 指引 |
| `discover` | 检查 AI 是否讲清业务入口、调用链、状态变化、副作用、例子和证据 |
| `contract` | 写入 `capability-map.yaml` 和 `.feature` 契约 |
| `verify` | 运行 BDD，并确认 report 覆盖目标 feature/scenario |
| `lint` | 执行项目自定义代码质量规则和宿主项目 lint 命令 |
| `check` | 只检查 harness 契约治理，不替代代码 lint |

## 引导主题

`guide` 是给 AI 和开发者看的任务入口说明。它不读取当前项目，只解释某类任务应该走什么流程、使用哪些工具、遵守哪些目录和契约规则。

常用主题：

- `new-project`：新项目第一次接入。
- `legacy-project`：旧项目补业务契约。
- `new-feature`：新增业务能力。
- `change-feature`：修改已有业务能力。
- `frontend-backend-e2e`：前端、后端、E2E 多目标协作。
- `verify-failed`：BDD 验证失败后的处理路径。
- `capability-map`：能力地图结构说明。
- `harness-yaml`：项目配置说明。

## 项目结构

宿主项目接入后建议使用：

```text
your-project/
├── harness.yaml
└── harness/
    ├── _charter/
    │   ├── architecture.md
    │   ├── conventions.md
    │   └── project-constraints.md
    ├── capability-map.yaml
    ├── sources/
    │   ├── 2026-05-08-code-inference-order-create.md
    │   └── 2026-05-10-manual-confirmation-order-create.md
    ├── features/
    │   └── <target>/
    │       └── <domain>/
    │           └── <capability>.feature
    ├── flows/
    │   └── <target>/
    │       └── <domain>/
    │           └── <journey>.feature
    ├── lint/
    │   └── rules.yaml
    ├── agent-skills/
    │   └── <skill-name>/
    │       └── SKILL.md
    └── constraints/
        └── <rule>.feature
```

`harness/` 只放业务契约、全局章程和治理规则，不放 BDD runner、step definitions、测试辅助代码或测试报告。

`_charter` 是保留目录，用 Markdown 放全局项目约定，例如架构、命名规范、模块边界和编码约束。下划线的目的只是把它和普通业务域区分开，并让 AI 在文件树里优先看到。

## harness.yaml

最小配置：

```yaml
version: 1
spec_dir: harness
charter_dir: harness/_charter
language: zh-CN
targets:
  - api
  - web
  - e2e

workspace:
  target: api

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

commands:
  lint:
    cmd: "npm run lint && npm run typecheck"
    workdir: "."
    timeout_ms: 300000
```

路径规则：

- `workdir` 是 BDD 命令执行目录。
- `{feature}` 会渲染为相对 `workdir` 的 feature 路径。
- `report.path` 也按 `workdir` 解析。

语言规则：

- `language` 可选 `zh-CN` 或 `en`，缺省为 `zh-CN`。
- `language: zh-CN` 时，feature 文件头必须写 `# language: zh-CN`，并包含 `意图 / 边界 / 待确认`。
- `language: en` 时，feature 文件头必须写 `# language: en`，并包含 `Intent / Boundaries / To Confirm`。

目标规则：

- `targets` 是项目允许的验证目标，例如 `api`、`web`、`mobile`、`thirdparty`、`worker`、`e2e`。
- `target` 不是团队名，而是这份契约站在哪个系统入口或交付面验证业务。
- `workspace.target` 可选，用于子仓库或局部工作区限制当前 AI 只能写某个 target。

## 能力地图

`capability-map.yaml` 用来固定业务能力边界，避免不同模型随意拆分。

```yaml
version: 1
domains:
  order:
    capabilities:
      - id: api.order.create
        file: features/api/order/create.feature
        entrypoint: OrderController#create
        intent: 创建订单并锁定库存
      - id: web.order.create
        file: features/web/order/create.feature
        entrypoint: /orders/new
        intent: 前端承载创建订单入口和待支付状态展示
flows:
  - id: e2e.order.customerPurchase
    file: flows/e2e/order/customer-purchase.feature
    uses:
      - api.order.create
      - web.order.create
```

划分规则：

- 一个 capability 对应一个稳定业务目的，不按接口数量机械拆分，也不把完整用户旅程塞进单个 capability。
- capability id 使用 `<target>.<domain>.<action>`；去掉 target 后的 `<domain>.<action>` 可自然对齐不同验证目标。
- capability 文件必须放在 `features/<target>/<domain>/` 下。
- flow id 使用 `<target>.<domain>.<flowName>`，文件必须放在 `flows/<target>/<domain>/` 下。
- `entrypoint` 写业务入口方法；新需求还没有代码时可以写 `planned:<入口名称>`。
- 一个 capability 可以覆盖多个规则分支，但这些分支必须服务同一个业务目的。
- 跨多个 capability 的连续用户路径写在 `flows/`，并通过 `uses` 引用能力。

## 业务发现

`discover` 用在写 feature 之前。AI 先阅读 PRD 或代码，再把发现结果提交给 MCP 校验。

发现包至少应包含：

- 业务目标：用户或系统要达成什么结果。
- 入口：Controller、Handler、Job、Command 或计划入口。
- 调用链：入口到核心 service/repository 的业务路径。
- 业务规则：校验、过滤、分支、状态流转、权限、异常处理。
- 状态变化：会创建、修改、删除或保持不变的对象和状态。
- 副作用：库存、消息、日志、缓存、任务、通知、快照、上报等变化；没有副作用也要写明。
- 业务示例：正常、边界、异常和权限场景。
- 证据：PRD 段落、代码路径、方法名或人工确认来源。
- 待确认问题：无法从现有材料判断的业务点。

`discover` 通过后仍需要人工确认。人工确认的是“业务边界和规则是否正确”，不是 step 实现。

`discover` 不写文件。它会输出 Feature Discovery Review，自审项包括：

- 是否有业务入口。
- 代码/混合来源是否有调用链。
- 业务规则是否不是空泛的“接口成功”。
- 是否说明状态变化。
- 是否说明副作用或无副作用保障。
- 是否有正常、失败或边界例子。
- 是否有证据来源。
- 是否列出待确认问题。

## 业务来源

进入 feature 的业务承诺必须能追溯到来源。来源不等于 PRD；它可以是正式 PRD、人工确认、会议纪要、工单、代码推断或现有测试推断。

来源文档统一放在 `harness/sources/`，文件名按日期命名：

```text
harness/sources/
├── 2026-05-08-code-inference-order-create.md
├── 2026-05-10-manual-confirmation-order-create.md
└── 2026-05-20-campaign-adjustment.md
```

source 文件不需要 frontmatter，可以是普通 Markdown：

```md
# 创建订单规则代码推断

## 优惠计算失败

从 OrderService#create 推断：优惠失败时不创建订单，不锁库存。

待确认：
- 该行为是产品规则，还是历史实现偶然结果。
```

feature 的 `规则/Rule` 下必须使用固定注释块声明来源：

```gherkin
规则: 优惠计算失败时不创建订单
  # sources:
  #   current: sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理
  #   timeline:
  #     - sources/2026-05-08-code-inference-order-create.md#优惠计算失败
  #     - sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理

  场景: 优惠服务返回失败
    假设 客户已登录
    当 客户使用不可计算的优惠下单
    那么 不应创建订单
```

规则：

- 只认 `# sources:`，不认 `# source:`、`# 需求来源:` 或其他变体。
- `current` 必须出现在 `timeline` 中。
- `timeline` 按 source 文件日期从旧到新排列。
- 如果单个场景的来源不同，可以在 `场景/Scenario` 下写自己的 `# sources:` 块。
- `contract` 写入前会硬校验；`check` 会全量扫描，防止手写绕过。

旧项目接入时，可以先把代码推断沉淀为 source，再逐步补人工确认 source。

## Feature 契约

`contract` 会一起校验并写入 `capability-map.yaml` 和 `.feature`。能力 feature 应使用 Rule-first 结构：

```gherkin
# language: zh-CN
# capability: api.order.create
# entrypoint: OrderController#create
@order @create

功能: 创建订单

  意图:
    - 客户提交有效购买请求后,系统创建待支付订单并锁定库存。

  边界:
    - 本能力只负责订单创建,不负责支付、发货和售后。

  待确认:
    - 无

  规则: 有库存商品可以创建订单
    # sources:
    #   current: sources/2026-05-08-code-inference-order-create.md#有库存商品可以创建订单
    #   timeline:
    #     - sources/2026-05-08-code-inference-order-create.md#有库存商品可以创建订单

    场景: 客户购买有库存商品
      假设 客户已登录
      而且 商品 "sku-001" 可售库存为 5
      当 客户购买 2 件商品 "sku-001"
      那么 应创建一笔待支付订单
      而且 商品 "sku-001" 的可售库存应减少 2

  规则: 库存不足时不能创建订单
    # sources:
    #   current: sources/2026-05-08-code-inference-order-create.md#库存不足时不能创建订单
    #   timeline:
    #     - sources/2026-05-08-code-inference-order-create.md#库存不足时不能创建订单

    场景: 客户购买超过库存数量
      假设 客户已登录
      而且 商品 "sku-002" 可售库存为 1
      当 客户购买 2 件商品 "sku-002"
      那么 应拒绝创建订单
      而且 商品 "sku-002" 的可售库存不应变化
```

Feature 自审触发时机：

- `contract` 写入成功后。
- 人工或 AI 修改 `harness/features/**/*.feature` 或 `harness/flows/**/*.feature` 后。

Feature Contract Review 只审业务契约：

| 检查项 | 要求 |
|---|---|
| 能力边界 | 是否只表达一个业务目的 |
| 入口证据 | 是否有 `# entrypoint` 或 planned 入口 |
| 来源追溯 | 每个 Rule/Scenario 是否有合法 `# sources:` 块 |
| 规则分组 | 是否用 `规则/Rule` 表达业务分支 |
| 结构顺序 | Scenario/场景 是否都写在 Rule/规则 下 |
| 场景覆盖 | 正常、边界、异常、权限是否按需覆盖 |
| Then 可验证性 | Then 是否描述可观测业务结果 |
| 待确认 | 不确定内容是否明确写出 |

## BDD Step Definitions

Step definitions 写在宿主项目自己的测试目录里，不写在 `harness/` 里。

推荐使用语言无关的职责目录：

```text
your-project/
├── harness/
│   └── features/api/order/create.feature
└── tests-or-src-test/
    └── contract/
        └── bdd/
            ├── runner/
            ├── config/
            ├── steps/
            │   └── order/
            ├── support/
            └── reports/
```

不同技术栈只做路径映射，不改变职责分层：

```text
Java:   src/test/java/<base>/contract/bdd/{runner,config,steps,support}
Node:   tests/contract/bdd/{runner,config,steps,support}
Python: tests/contract/bdd/{runner,config,steps,support}
Go:     test/contract/bdd/{runner,config,steps,support}
```

AI 生成 BDD 测试时必须遵守：

- `runner/` 是测试套件入口，默认一个 suite 一个 runner，不按 feature 复制。
- `config/` 只放测试环境配置。
- `steps/` 必须按业务域再分一层，例如 `steps/order/`。
- `support/` 放 API client、fixture、factory、cleaner、helper、公共断言。
- 不要把 `*Steps`、`*RunnerTest`、`*Config` 平铺在 `bdd/` 根目录。

Cucumber 根据步骤文本匹配 step definitions。Feature 中的：

```gherkin
那么 应创建一笔待支付订单
```

需要在项目测试中有同文本或正则匹配的 step，并且断言要覆盖同等级证据：

```ts
Then("应创建一笔待支付订单", async function () {
  expect(response.orderId).toBeTruthy();
  expect(response.status).toBe("PENDING_PAYMENT");
  expect(response.items[0].sku).toBe("sku-001");
  expect(response.items[0].quantity).toBe(2);
});
```

如果 Then 写“订单确认页展示待支付订单和库存锁定提示”，step 只断言 API 返回订单编号是不够的；它必须使用 UI/DOM/截图等证据证明展示结果。

Step Evidence Review 触发时机：

- 新增或修改 step definitions 后。
- `verify` PASS 后。

Step Evidence Review 只审 step 证据：

| 检查项 | 要求 |
|---|---|
| 文本匹配 | 每个 Given/When/Then 都有明确 step |
| Then 对齐 | Then 描述什么，step 就断言什么 |
| 证据等级 | API Then 用 API 断言；UI Then 用 DOM/视觉证据；DB Then 用数据库断言 |
| 负例覆盖 | 异常、权限、不可见状态不能只测成功路径 |
| 假通过风险 | skipped/pending/undefined 不算通过 |

## 验证

`verify` 使用宿主项目配置的 BDD 命令执行目标 feature 或 flow：

```text
verify({ "target": "api.order.create" })
verify({ "target_type": "flow", "target": "e2e.order.customerPurchase" })
```

验证成功必须同时满足：

- 命令退出码为 0。
- 报告文件是本次运行新生成的，不使用旧报告。
- 报告覆盖目标 feature 和目标 scenario。
- 所有目标 scenario 都是 passed。
- failed、skipped、pending、undefined 都为 0。

## 代码质量 Lint

`lint` 是独立的代码质量门禁，用来拦 AI 写出来的低质量代码。它和 `check` 分工不同：

- `lint` 管宿主项目代码质量。
- `check` 管 harness 契约质量、map 对齐和 constraints。

`lint` 不内置代码风格规则。默认只执行项目显式配置的 `harness/lint/rules.yaml` 和 `commands.lint`。

项目可以在 `harness/lint/rules.yaml` 里追加自定义禁用规则。默认不生成任何自定义规则；只有项目明确约定后才添加。`pattern` 是行级 JavaScript 正则，命中即失败：

```yaml
version: 1
rules:
  - id: <rule-id>
    pattern: "<line-level JavaScript regex>"
    message: "<命中时的错误说明>"
    fix: "<建议修正方式>"
```

`harness/lint/rules.yaml` 适合拦“不要出现这类代码”的简单规则。需要跨行语义分析时，用项目自己的 lint/checkstyle/PMD/ArchUnit/ESLint 规则，并接入 `commands.lint`：

```yaml
commands:
  lint:
    cmd: "npm run lint && npm run typecheck"
    workdir: "."
    timeout_ms: 300000
```

Java 项目可以配置成：

```yaml
commands:
  lint:
    cmd: "mvn -q -DskipTests=false verify"
    workdir: "."
    timeout_ms: 600000
```

## 项目公共 Agent Skills

`harness/agent-skills/` 是项目内公共 Agent Skill 的保存位置：

```text
harness/
└── agent-skills/
    └── <skill-name>/
        └── SKILL.md
```

MCP 只做索引，不负责加载、安装或校验 skill 内容。

- `project_context` 会列出 `harness/agent-skills/*/SKILL.md`。
- 如果 `SKILL.md` frontmatter 里有 `description`，索引会显示它。
- MCP 不会自动把 skill 加入 `.claude/skills`、`.codex/skills` 或其他客户端目录。
- 是否使用、怎么同步到客户端目录，由用户和团队自己决定。

`check` 用来做 harness 契约治理检查。它不做宿主项目代码风格判断；代码质量交给 `lint` 和 `commands.lint`。

- feature 是否缺少 `# entrypoint`。
- feature 是否缺少 `规则/Rule`。
- Scenario/场景 是否写在第一个 Rule/规则 前。
- Then 是否过于泛化。
- Rule/Scenario 是否缺少固定 `# sources:` 来源块。
- `sources/` 文件是否按 `YYYY-MM-DD-xxx.md` 命名。
- `timeline` 是否按日期升序，`current` 是否在 `timeline` 中。
- 业务 feature 是否放在 `harness/features/<target>/<domain>/` 下。
- flow 是否放在 `harness/flows/<target>/<domain>/` 下。
- `capability-map.yaml` 与 feature/flow 是否对齐。
- `harness/` 下是否混入 BDD 实现代码。
- 项目配置的 constraints 是否通过。

## 本地接入

推荐把 `harness-mcp` 作为项目级 MCP 接入。这样团队成员在项目根目录打开 Claude Code 时，MCP 默认作用于当前项目，不需要在配置里写每个人本机的绝对路径。

运行要求：Node.js 20+。

项目根目录执行：

```bash
claude mcp add --scope project --transport stdio harness -- npx -y harness-mcp
```

生成的 `.mcp.json` 类似：

```json
{
  "mcpServers": {
    "harness": {
      "command": "npx",
      "args": ["-y", "harness-mcp"]
    }
  }
}
```

如果还没有发布到 npm，可以临时从 GitHub 运行：

```bash
claude mcp add --scope project --transport stdio harness -- bunx github:jiongQAQ/harness-mcp
```

`harness-mcp` 默认从当前工作目录向上查找 `harness.yaml`，如果项目还没有初始化，则使用当前 Git 仓库根目录。`HARNESS_PROJECT_ROOT` 只作为高级场景的显式覆盖，例如 CI、非项目级 MCP 客户端或调试固定目录。

首次接入后，让 AI 调用：

```text
init
project_context
```

## 安装与开发

```bash
bun install
bun run start
bun run typecheck
```

MCP 入口：

```text
src/index.ts
```

Claude Code 配置示例：

```json
{
  "mcpServers": {
    "harness": {
      "command": "bun",
      "args": ["run", "/abs/path/to/harness-mcp/src/index.ts"]
    }
  }
}
```

## 本仓库验证

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-init-guide-discover.ts
bun run scripts/test-discover.ts
bun run scripts/test-contract.ts
bun run scripts/test-sources.ts
bun run scripts/test-language.ts
bun run scripts/test-context-charter.ts
bun run scripts/test-schema-guidance.ts
bun run scripts/test-verify-bdd.ts
bun run scripts/test-lint.ts
bun run scripts/test-check-governance.ts
bun run scripts/test-targets.ts
```
