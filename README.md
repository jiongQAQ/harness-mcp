# harness-mcp

`harness-mcp` 是面向 AI 辅助开发的业务契约 MCP Server。它把项目规则、业务能力、BDD 验证和治理检查整理成一组稳定工具，让不同模型按同一套业务边界工作。

它不内置测试框架，也不管理 step definitions。宿主项目继续使用自己的 Cucumber、Playwright、JUnit、pytest 等测试体系；`harness-mcp` 只负责帮助 AI 梳理业务、写入契约、调用项目配置的验证命令，并检查报告是否真正覆盖目标场景。

## 核心目标

- 让 AI 先理解业务能力，再修改代码。
- 让新需求从 PRD/人工描述沉淀为可审查的 `.feature` 契约。
- 让已有代码可以反向梳理入口方法、调用链、规则和示例。
- 让 BDD 通过不只是“命令成功”，而是报告覆盖目标 feature/scenario 且没有 skipped/pending/undefined。
- 让多模型协作时使用统一的能力划分规则。

## 工具

| 工具 | 作用 |
|---|---|
| `help` | 查看推荐工作流、目录约定和自审要求 |
| `context` | 读取项目章程、能力索引和 AI 提示 |
| `discover` | 把 PRD/代码阅读结果整理成业务发现包，不写文件 |
| `contract` | 校验并写入 `capability-map.yaml` 和 `.feature` 契约 |
| `read` | 列出、读取或搜索业务契约 |
| `verify` | 按 `bdd` 配置运行 capability/flow，并校验报告覆盖 |
| `lint` | 强制检查 AI 新增代码坏味道，并执行宿主项目 lint 命令 |
| `check` | 执行治理检查和内置静态检查 |

推荐流程：

```text
context -> discover -> 人工确认 -> contract -> Feature Contract Review -> 写 tests/steps 与实现 -> verify -> Step Evidence Review -> lint -> check
```

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
    ├── features/
    │   └── <domain>/
    │       └── <capability>.feature
    ├── flows/
    │   └── <journey>.feature
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

## Feature 契约

`contract` 会一起校验并写入 `capability-map.yaml` 和 `.feature`。能力 feature 应使用 Rule-first 结构：

```gherkin
# language: zh-CN
# capability: order.create
# entrypoint: OrderController#create
@order @create

功能: 创建订单

  业务来源:
    - PRD: 订单创建流程
    - 代码: OrderController#create

  意图:
    - 客户提交有效购买请求后,系统创建待支付订单并锁定库存。

  边界:
    - 本能力只负责订单创建,不负责支付、发货和售后。

  待确认:
    - 无

  规则: 有库存商品可以创建订单
    场景: 客户购买有库存商品
      假设 客户已登录
      而且 商品 "sku-001" 可售库存为 5
      当 客户购买 2 件商品 "sku-001"
      那么 应创建一笔待支付订单
      而且 商品 "sku-001" 的可售库存应减少 2

  规则: 库存不足时不能创建订单
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
| 规则分组 | 是否用 `规则/Rule` 表达业务分支 |
| 场景覆盖 | 正常、边界、异常、权限是否按需覆盖 |
| Then 可验证性 | Then 是否描述可观测业务结果 |
| 待确认 | 不确定内容是否明确写出 |

## BDD Step Definitions

Step definitions 写在宿主项目自己的测试目录里，不写在 `harness/` 里。

示例：

```text
your-project/
├── harness/
│   └── features/order/create.feature
└── src/test/
    └── java/.../steps/OrderCreateSteps.java
```

或者：

```text
your-project/
├── harness/
│   └── features/order/create.feature
└── tests/
    └── bdd/steps/order-create.steps.ts
```

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

如果 Then 写“右侧面板展示章节结构化预览”，step 只断言 API 返回章节数组是不够的；它必须使用 UI/DOM/截图等证据证明展示结果。

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

默认 `lint` 扫描本次新增/修改的源码行，内置拦截：

- `console.log/debug/dir/trace`
- `debugger`
- `@ts-ignore`
- `eslint-disable`
- 空 `catch`
- `System.out/System.err` 调试输出

项目应在 `harness.yaml` 里配置自己的 lint 命令：

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

`check` 用来做治理检查：

- feature 是否缺少 `# entrypoint`。
- feature 是否缺少 `规则/Rule`。
- Then 是否过于泛化。
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
bun run scripts/test-verify-bdd.ts
bun run scripts/test-lint.ts
bun run scripts/test-check-governance.ts
```
