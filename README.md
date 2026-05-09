# harness-mcp

`harness-mcp` 是面向 AI 辅助开发的业务契约 MCP Server。它把项目规则、业务能力、BDD 验证和治理检查整理成一组稳定工具，让不同模型按同一套业务边界工作。

它不内置测试框架，也不管理 step definitions。宿主项目继续使用自己的 Cucumber、Playwright、JUnit、pytest 等测试体系；`harness-mcp` 只负责帮助 AI 梳理业务、写入契约、调用项目配置的验证命令，并检查报告是否真正覆盖目标场景。

## 核心目标

- 让 AI 先理解业务能力，再修改代码。
- 让新需求从 PRD/人工描述沉淀为可审查的 `.feature` 契约。
- 让每条业务规则能追溯到 PRD、人工确认、代码推断等来源文档。
- 让已有代码可以反向梳理入口方法、调用链、规则和示例。
- 让 BDD 通过不只是“命令成功”，而是报告覆盖目标 feature/scenario 且没有 skipped/pending/undefined。
- 让多模型协作时使用统一的能力划分规则。

## 工具

| 工具 | 作用 |
|---|---|
| `guide` | 查看推荐工作流、目录约定和自审要求；不读取项目 |
| `project_context` | 读取项目章程、能力索引和 AI 提示 |
| `discover` | 把 PRD/代码阅读结果整理成业务发现包，不写文件 |
| `contract` | 校验并写入 `capability-map.yaml` 和 `.feature` 契约 |
| `read_contract` | 列出、读取或搜索业务契约 |
| `read_source` | 列出、读取或搜索业务来源文档 |
| `verify` | 按 `bdd` 配置运行 capability/flow，并校验报告覆盖 |
| `lint` | 执行 `harness/lint/rules.yaml` 和宿主项目 lint 命令 |
| `check` | 执行治理检查和内置静态检查 |

推荐流程：

```text
project_context -> discover -> 人工确认 -> contract -> Feature Contract Review -> 写 tests/steps 与实现 -> verify -> Step Evidence Review -> lint -> check
```

格式不确定时先查 `guide`，常用主题包括 `harness-yaml`、`capability-map`、`sources`、`contract`、`bdd`、`lint`、`agent-skills` 和 `check`。

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
    │   └── <domain>/
    │       └── <capability>.feature
    ├── flows/
    │   └── <journey>.feature
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

## 能力地图

`capability-map.yaml` 用来固定业务能力边界，避免不同模型随意拆分。

```yaml
version: 1
domains:
  order:
    capabilities:
      - id: order.create
        file: features/order/create.feature
        entrypoint: OrderController#create
        intent: 创建订单并锁定库存
flows:
  - id: order.customerPurchase
    file: flows/customer-purchase.feature
    uses:
      - order.create
```

划分规则：

- 一个 capability 对应一个稳定业务目的，不按接口数量机械拆分，也不把完整用户旅程塞进单个 capability。
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
- 业务示例：正常、边界、异常和权限场景。
- 证据：PRD 段落、代码路径、方法名或人工确认来源。
- 待确认问题：无法从现有材料判断的业务点。

`discover` 通过后仍需要人工确认。人工确认的是“业务边界和规则是否正确”，不是 step 实现。

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
# capability: order.create
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
│   └── features/order/create.feature
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
verify({ "target": "order.create" })
verify({ "target_type": "flow", "target": "order.customerPurchase" })
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

`check` 用来做治理检查：

- feature 是否缺少 `# entrypoint`。
- feature 是否缺少 `规则/Rule`。
- Scenario/场景 是否写在第一个 Rule/规则 前。
- Then 是否过于泛化。
- Rule/Scenario 是否缺少固定 `# sources:` 来源块。
- `sources/` 文件是否按 `YYYY-MM-DD-xxx.md` 命名。
- `timeline` 是否按日期升序，`current` 是否在 `timeline` 中。
- 业务 feature 是否放在 `harness/features/<domain>/` 下。
- `capability-map.yaml` 与 feature/flow 是否对齐。
- `harness/` 下是否混入 BDD 实现代码。
- 项目配置的 constraints 是否通过。

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
      "args": ["run", "/abs/path/to/harness-mcp/src/index.ts"],
      "env": {
        "HARNESS_PROJECT_ROOT": "/abs/path/to/your-project"
      }
    }
  }
}
```

`HARNESS_PROJECT_ROOT` 指向包含 `harness.yaml` 的宿主项目根目录。不设置时使用 MCP Server 当前工作目录。

## 本仓库验证

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-discover.ts
bun run scripts/test-contract.ts
bun run scripts/test-sources.ts
bun run scripts/test-language.ts
bun run scripts/test-context-charter.ts
bun run scripts/test-schema-guidance.ts
bun run scripts/test-verify-bdd.ts
bun run scripts/test-lint.ts
bun run scripts/test-check-governance.ts
```
