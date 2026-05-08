import { z } from "zod";
import { CAPABILITY_MAP_SCHEMA_HELP } from "../capability_map.ts";
import { HARNESS_CONFIG_SCHEMA_HELP } from "../config.ts";
import { LINT_RULES_SCHEMA_HELP } from "../lint_rules.ts";
import {
  findToolHelp,
  HELP_TOPICS,
  TOOL_CATALOG,
  type ToolCatalogEntry,
} from "../tool_catalog.ts";

export const HelpInputSchema = z.object({
  topic: z
    .string()
    .optional()
    .describe("指南主题: overview/workflow/tools/discover/contract/harness-yaml/capability-map/feature/bdd/lint/check 或工具名"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type HelpInput = z.infer<typeof HelpInputSchema>;

export async function executeHelp(input: HelpInput): Promise<string> {
  const topic = input.topic?.trim().toLowerCase() ?? "";
  if (input.raw) {
    return JSON.stringify({ default_language: "zh-CN", topics: allTopics(), tools: TOOL_CATALOG }, null, 2);
  }
  if (!topic || topic === "overview") return renderOverview();
  if (topic === "workflow") return renderWorkflow();
  if (topic === "tools") return renderTools();
  if (topic === "discover") return renderDiscoverGuide();
  if (topic === "contract" || topic === "feature") return renderContractGuide();
  if (topic === "harness-yaml") return renderHarnessYamlGuide();
  if (topic === "capability-map") return renderCapabilityMapGuide();
  if (topic === "bdd") return renderBddGuide();
  if (topic === "lint") return renderLintGuide();
  if (topic === "check") return renderCheckGuide();
  const tool = findToolHelp(topic);
  if (tool) return renderToolHelp(tool);
  return `未知 guide topic: ${topic}\n可用 topic: ${allTopics().join(", ")}`;
}

function renderOverview(): string {
  return [
    "harness-mcp guide",
    "",
    "harness-mcp 是业务发现驱动的 BDD 契约层。它不替代 Cucumber/behave/godog,只负责引导 AI 先发现业务规则,再写可执行业务契约,最后校验 BDD report 是否真的覆盖目标 feature。",
    "",
    "核心流程:",
    "  新需求/已有代码 -> discover -> 人工确认 -> contract -> Feature Contract Review -> 写测试和实现 -> verify -> Step Evidence Review -> lint -> check",
    "",
    "公开工具:",
    ...TOOL_CATALOG.map((tool) => `  - ${tool.name}: ${tool.description}`),
    "",
    "默认写中文 Gherkin: # language: zh-CN,并使用 功能 / 规则 / 场景 / 假设 / 当 / 那么。",
  ].join("\n");
}

function renderWorkflow(): string {
  return [
    "推荐工作流",
    "",
    "新需求:",
    "  PRD/用户描述 -> discover 输出业务发现包 -> 人工确认 -> contract 写 map + feature -> 写测试和实现 -> verify/lint/check",
    "",
    "已有代码补契约:",
    "  入口方法/API/Consumer/Job -> discover 读取调用链并推导业务规则 -> 人工确认 -> contract 补 feature 和测试 -> verify/lint/check",
    "",
    "纯重构:",
    "  feature 不变 -> 改代码 -> verify/lint/check",
    "",
    "判断标准:",
    "  discover 负责防止 AI 只写接口成功。",
    "  contract 负责防止 Rule-less feature 和空泛 Then 落盘。",
    "  verify 负责证明本次 BDD report 覆盖目标 feature 且全部场景 passed。",
    "  lint 负责执行 harness/lint/rules.yaml 自定义禁用规则和宿主项目 lint 命令。",
    "  Step Evidence Review 负责证明每个 Then 被同等级断言验证。",
  ].join("\n");
}

function renderDiscoverGuide(): string {
  return [
    "discover: 业务发现",
    "",
    "discover 不写文件。它校验 AI 是否已经从 PRD 或代码入口挖出真实业务规则。",
    "",
    "必须输出:",
    "  - 业务入口: API / Controller / Application Service / Consumer / Job",
    "  - 调用链: 入口到结束涉及的核心 service",
    "  - 业务规则: 权限、状态、过滤、排序、字段隐藏、副作用、异常分支",
    "  - 业务例子: 成功、失败、边界、异常",
    "  - 待确认问题: 未确认内容不能写成承诺",
    "  - 证据来源: PRD / 用户提供 / 代码推断 / 现有测试 / 人工确认",
    "",
    "通过后下一步是 Human Confirmation,不是直接写代码。",
  ].join("\n");
}

function renderContractGuide(): string {
  return [
    "contract: 业务契约",
    "",
    "contract 写入 capability-map.yaml 和 .feature。capability-map.yaml 必须使用 domains.<domain>.capabilities[] 结构:",
    "",
    CAPABILITY_MAP_SCHEMA_HELP,
    "",
    "feature 必须是 Rule-first:",
    "",
    "```gherkin",
    "# language: zh-CN",
    "# capability: order.create",
    "# entrypoint: OrderController#create",
    "@order",
    "",
    "功能: 创建订单",
    "",
    "  业务来源:",
    "    - 代码推断: OrderController#create",
    "",
    "  意图:",
    "    - 客户提交有效购买请求后,系统创建待支付订单并锁定库存。",
    "",
    "  边界:",
    "    - 只定义订单创建,不定义支付、发货和售后。",
    "",
    "  待确认:",
    "    - 库存预占超时时间由其他能力定义。",
    "",
    "  规则: 有库存商品可以创建订单",
    "",
    "    场景: 客户购买有库存商品",
    "      假设 客户已登录",
    "      当 客户购买 2 件商品 \"sku-001\"",
    "      那么 应创建一笔待支付订单",
    "```",
    "",
    "禁止空泛 Then: 应返回成功 / 应返回完整内容 / 接口调用成功 / 状态码 200。",
  ].join("\n");
}

function renderHarnessYamlGuide(): string {
  return [
    "harness.yaml: 项目接入配置",
    "",
    "harness.yaml 放在宿主项目根目录,用于声明 harness 目录、BDD runner、项目 lint 命令和可选 AI 提示。",
    "",
    HARNESS_CONFIG_SCHEMA_HELP,
  ].join("\n");
}

function renderCapabilityMapGuide(): string {
  return [
    "capability-map.yaml: 能力地图 schema",
    "",
    "capability-map.yaml 用来固定业务能力边界,避免不同模型随意拆分 capability。",
    "",
    CAPABILITY_MAP_SCHEMA_HELP,
  ].join("\n");
}

function renderBddGuide(): string {
  return [
    "BDD 验证与 Step Evidence Review",
    "",
    "verify 只证明 BDD runner 跑过目标 feature 且 report 覆盖全部场景。它不自动证明 Then 的业务语义正确。",
    "",
    "目录治理:",
    "  - harness/ 只放业务契约,不放 runner/config/steps/support",
    "  - BDD 执行代码推荐 tests-or-src-test/contract/bdd/{runner,config,steps,support}",
    "  - runner 默认一个 suite 一个,不要按 feature 复制",
    "  - steps 必须按业务域分目录,例如 steps/order/OrderSteps",
    "  - API client、fixture、factory、cleaner、helper 放 support/",
    "",
    "verify PASS 后必须输出 Step Evidence Review:",
    "| Then | 实际断言 | 证据等级 | 是否匹配 |",
    "|---|---|---|---|",
    "| 不应返回答案和解析 | assert answer == null && analysis == null | API response | 是 |",
    "",
    "Then 写 UI 展示时,API 断言不够;必须用 DOM、浏览器或视觉证据。",
  ].join("\n");
}

function renderLintGuide(): string {
  return [
    "lint: 项目代码质量门禁",
    "",
    "lint 独立于 check。check 管 harness 契约质量;lint 执行项目显式配置的代码质量规则。",
    "",
    "默认行为:",
    "  - scope=diff: 只扫描本次新增/修改的源码行",
    "  - 同时读取 harness/lint/rules.yaml;配置后会执行项目自定义禁用规则",
    "  - 默认不生成自定义规则;必须按项目约定显式添加",
    "  - 同时读取 commands.lint;配置后会执行宿主项目自己的 lint 命令",
    "  - 不内置 console/debugger/try-catch 等代码风格规则",
    "",
    "自定义规则:",
    LINT_RULES_SCHEMA_HELP,
    "",
    "推荐配置:",
    "  commands:",
    "    lint:",
    "      cmd: \"npm run lint && npm run typecheck\"",
    "      workdir: \".\"",
  ].join("\n");
}

function renderCheckGuide(): string {
  return [
    "check: 静态治理和项目约束",
    "",
    "check 会检查:",
    "  - feature 缺 # entrypoint",
    "  - feature 缺 Rule/规则",
    "  - Then 写得过于空泛",
    "  - 业务 feature 不在 harness/features/<业务域>/ 下",
    "  - _charter 章程误写成 .feature,应使用 Markdown",
    "  - capability-map.yaml 与 features/flows 不对齐",
    "  - BDD steps 或 runner config 被写进 harness/",
    "  - harness/constraints 下的项目约束",
  ].join("\n");
}

function renderTools(): string {
  const lines = ["全部工具", ""];
  for (const [group, tools] of groupTools()) {
    lines.push(`${group}:`);
    for (const tool of tools) lines.push(`  - ${tool.name}: ${tool.description}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderToolHelp(tool: ToolCatalogEntry): string {
  return [
    tool.name,
    "",
    tool.description,
    "",
    `使用场景: ${tool.useWhen}`,
    `常用参数: ${tool.commonArgs.join(", ")}`,
    `示例: ${tool.example}`,
    ...(tool.notes.length ? ["", "注意:", ...tool.notes.map((note) => `  - ${note}`)] : []),
  ].join("\n");
}

function allTopics(): string[] {
  return [...new Set([...HELP_TOPICS, ...TOOL_CATALOG.map((tool) => tool.name)])];
}

function groupTools(): Array<[string, ToolCatalogEntry[]]> {
  const grouped = new Map<string, ToolCatalogEntry[]>();
  for (const tool of TOOL_CATALOG) {
    const tools = grouped.get(tool.group) ?? [];
    tools.push(tool);
    grouped.set(tool.group, tools);
  }
  return [...grouped.entries()];
}
