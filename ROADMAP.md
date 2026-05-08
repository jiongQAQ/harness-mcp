# harness-mcp Roadmap

## 产品原则

`harness-mcp` 保持小而硬的工具面。它的职责是让 AI 围绕业务契约工作，而不是扩展成通用测试平台或项目脚手架。

核心原则：

- 业务先于实现：先发现和确认能力，再写 feature、steps 和代码。
- 契约与实现分离：`harness/` 保存要验证什么，宿主项目测试目录保存怎么验证。
- 验证必须有证据：命令成功不等于业务通过，报告必须覆盖目标场景。
- 多模型一致：能力划分以 `capability-map.yaml` 为准。

## 当前版本

已实现 8 个公开工具：

| 工具 | 当前职责 |
|---|---|
| `help` | 输出工作流、目录约定和自审协议 |
| `context` | 加载 Markdown charter、能力索引、AI hints |
| `discover` | 校验 AI 从 PRD/代码整理出的业务发现包 |
| `contract` | 校验并写入 capability map 与 feature |
| `read` | 列表、读取、搜索业务契约 |
| `verify` | 运行 BDD capability/flow 并校验报告覆盖 |
| `lint` | 独立执行 AI 代码质量门禁 |
| `check` | 执行 constraints 和内置静态治理检查 |

## 当前能力

- 支持 `cucumber-json` 和 `surefire-xml` 报告解析。
- 支持 capability 与 flow 的 BDD 执行。
- 支持基于 feature/scenario 的报告覆盖校验。
- 支持旧报告检测，避免 verify 误用 stale report。
- 支持 feature 契约质量检查：入口、规则分组、泛化 Then、map 对齐、BDD 实现位置。
- 支持 `discover` 阶段要求 AI 提交入口、调用链、业务规则、业务示例、证据和待确认问题。
- 支持 `lint` 阶段扫描 AI 新增源码行的调试输出、禁用检查和空异常处理，并执行宿主项目 `commands.lint`。
- 支持 `_charter/*.md` 作为全局章程，并在 `check` 中拒绝 `_charter/*.feature`。

## 短期路线

1. **强化发现质量**
   - 增加更好的业务规则密度检查。
   - 对“只描述 API 成功”的发现包给出更明确的问题定位。
   - 支持按代码入口输出建议的 capability 拆分。

2. **强化 step 证据审查**
   - 在 `verify` 输出中暴露目标 Then 与报告 scenario 的对应关系。
   - 对 skipped/pending/undefined 给出可直接修复的定位。
   - 允许宿主项目提供 step evidence report 时做更细粒度校验。

3. **改进治理检查**
   - 支持项目自定义 constraints。
   - 支持 dependency-provided constraints。
   - 支持对 known exceptions 做显式记录。

4. **强化 lint 门禁**
   - 允许项目在 harness 中声明自定义 lint 规则。
   - 支持按语言启用/禁用内置规则。
   - 对 lint 例外要求显式原因和过期时间。

## 暂不做

- 不内置 Cucumber/Playwright/JUnit/pytest runner。
- 不管理 step definition 文件。
- 不生成模板式业务 feature。
- 不做 Web UI、历史数据库、多租户或鉴权。
- 不新增多套等价工具入口。

## 验证基线

每次改动至少运行：

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-discover.ts
bun run scripts/test-contract.ts
bun run scripts/test-verify-bdd.ts
bun run scripts/test-lint.ts
bun run scripts/test-check-governance.ts
```
