# harness-mcp 交接文档

## 当前定位

`harness-mcp` 是一个简洁的业务驱动 MCP。它不做测试框架、不托管 step definitions、不替代宿主项目的 runner；它只提供业务发现、契约写入、验证覆盖和治理检查。

目标闭环：

```text
context -> discover -> 人工确认 -> contract -> Feature Contract Review -> 写测试和实现 -> verify -> Step Evidence Review -> lint -> check
```

## 当前公开工具

| 工具 | 作用 |
|---|---|
| `help` | 输出工作流、目录规则和自审要求 |
| `context` | 读取 Markdown charter、能力索引和 AI hints |
| `discover` | 校验 PRD/代码阅读后的业务发现包，不写文件 |
| `contract` | 原子写入 capability map 和 feature 契约 |
| `read` | 列表、读取、搜索业务契约 |
| `verify` | 执行 BDD capability/flow 并校验报告覆盖 |
| `lint` | 强制检查 AI 新增代码坏味道并执行宿主项目 lint 命令 |
| `check` | 执行约束和内置静态治理检查 |

旧工具已从 MCP 注册表移除，旧实现文件也已删除。

## 关键约定

- `harness/` 只放契约，不放 BDD steps、runner 配置、测试报告或测试辅助代码。
- `_charter/` 只放 Markdown 章程，如 `architecture.md`、`conventions.md`、`project-constraints.md`。
- `capability-map.yaml` 是能力划分的唯一索引，必须声明 `id`、`file`、`entrypoint`、`intent`。
- capability feature 必须包含 `# capability`、`# entrypoint`、`业务来源`、`意图`、`边界`、`待确认`，并使用 `规则/Rule` 分组。
- flow feature 放在 `harness/flows`，通过 map 中的 `uses` 引用 capability。
- `verify` 不能信任旧报告；报告必须是本次运行产生的，并覆盖目标 feature/scenario。
- skipped、pending、undefined 都不算通过。
- `lint` 独立于 `check`；它检查宿主代码质量，`check` 检查 harness 契约质量。

## 重要源码

| 文件 | 作用 |
|---|---|
| `src/server.ts` | 注册公开 MCP tools |
| `src/tools/discover.ts` | 业务发现包校验 |
| `src/tools/contract.ts` | map + feature 契约写入 |
| `src/tools/read.ts` | 契约读取和搜索 |
| `src/tools/verify.ts` | BDD 执行、报告解析、覆盖校验 |
| `src/tools/lint.ts` | AI 代码质量门禁 |
| `src/tools/check.ts` | constraints 和静态治理检查 |
| `src/feature_quality.ts` | feature 质量规则 |
| `src/capability_map.ts` | capability map schema 与解析 |
| `src/bdd.ts` | BDD 命令构造和报告覆盖校验 |
| `src/report.ts` | 报告解析分发 |

## 验证脚本

```bash
bun run typecheck
bun run scripts/smoke.ts
bun run scripts/test-discover.ts
bun run scripts/test-contract.ts
bun run scripts/test-verify-bdd.ts
bun run scripts/test-lint.ts
bun run scripts/test-check-governance.ts
```

## 后续原则

- 工具数量保持少，不为同一动作拆多个入口。
- 优先加强 `discover`、`contract`、`verify`、`check` 的约束质量。
- `lint` 只做代码质量门禁，不扩展成第二套业务契约检查。
- 新增能力前先确认它是否能真实改善业务驱动闭环。
- 不把具体语言、框架或测试目录硬编码进 MCP；这些由宿主项目配置和测试代码负责。
