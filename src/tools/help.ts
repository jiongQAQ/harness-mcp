import { z } from "zod";
import { CAPABILITY_MAP_SCHEMA_HELP } from "../capability_map.ts";
import { HARNESS_CONFIG_SCHEMA_HELP } from "../config.ts";
import { LINT_RULES_SCHEMA_HELP } from "../lint_rules.ts";
import { SOURCE_BLOCK_TEMPLATE } from "../sources.ts";
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
    .describe("指南主题: overview/workflow/new-project/legacy-project/new-feature/change-feature/frontend-backend-e2e/verify-failed/tools/init/discover/contract/harness-yaml/capability-map/sources/feature/bdd/lint/agent-skills/check 或工具名"),
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
  if (topic === "new-project") return renderScenarioGuide({
    title: "new-project: 新项目从 0 接入",
    when: "项目还没有 harness 目录,需要先建立业务契约骨架。",
    action: '先调用 init({ mode: "new", targets: ["api", "web", "e2e"] }),再调用 project_context() 确认结构。',
    prepare: [
      "项目根目录路径",
      "本项目需要的 targets,例如 api/web/e2e;不确定时先用 api/web/e2e",
      "首批 PRD、人工确认或需求描述,后续放入 harness/sources/",
    ],
    next: [
      "不要直接写 feature",
      "先沉淀 source,再用 discover 输出业务发现包",
      "人工确认业务边界后再调用 contract",
    ],
  });
  if (topic === "legacy-project") return renderScenarioGuide({
    title: "legacy-project: 旧项目补业务契约",
    when: "代码已经存在,但缺少可追溯的业务契约和 BDD 保护。",
    action: '先调用 init({ mode: "legacy", targets: ["api"] }),再从真实入口方法开始 discover。',
    prepare: [
      "一个具体业务入口,例如 Controller/API/Consumer/Job",
      "入口到核心 Service/Repository/外部服务的调用链",
      "从代码、SQL、现有测试推断出的规则和不确定点",
    ],
    next: [
      "不要直接写 feature",
      "把代码推断沉淀到 harness/sources/YYYY-MM-DD-code-inference-xxx.md",
      "discover PASS 后必须人工确认,再 contract",
    ],
  });
  if (topic === "new-feature") return renderScenarioGuide({
    title: "new-feature: 新增业务能力",
    when: "用户提出新需求,需要拆分能力并落地 feature 契约。",
    action: "先阅读来源并调用 discover,不要先写代码或 step definitions。",
    prepare: [
      "需求来源: PRD、工单、会议纪要或人工描述",
      "拟定 capability id: <target>.<domain>.<action>",
      "正常、失败、边界例子和待确认问题",
    ],
    next: [
      "人工确认 discover 结果",
      "contract 写 capability-map.yaml 和 feature",
      "Feature Contract Review 后再写测试和实现",
    ],
  });
  if (topic === "change-feature") return renderScenarioGuide({
    title: "change-feature: 修改已有业务能力",
    when: "已有 capability 的规则发生变化,或需要补充场景。",
    action: "先 read_contract/read_source 读取旧契约和来源,再补充新的 source 和 discover。",
    prepare: [
      "被影响的 capability 或 flow",
      "本次变更来源文档",
      "新增、删除或改变的业务规则",
    ],
    next: [
      "保持 sources.timeline 从旧到新",
      "contract 更新 feature 后做 Feature Contract Review",
      "verify 相关 capability/flow,再做 Step Evidence Review",
    ],
  });
  if (topic === "frontend-backend-e2e") return renderScenarioGuide({
    title: "frontend-backend-e2e: 前端、后端和 E2E 协作",
    when: "一个业务同时涉及 api/web/thirdparty/e2e 等多个交付面。",
    action: "用 targets 区分交付面,用 capability-map 对齐同一个 domain/action。",
    prepare: [
      "harness.yaml targets,例如 api/web/thirdparty/e2e",
      "子仓库可设置 workspace.target 防止写错交付面",
      "跨端流程写 flows/<target>/<domain>/,不要塞进单个 capability",
    ],
    next: [
      "后端只写 api.* feature",
      "前端只写 web.* feature",
      "跨端用户旅程写 e2e.* flow 并 uses 相关 capability",
    ],
  });
  if (topic === "verify-failed") return renderScenarioGuide({
    title: "verify-failed: BDD 验证失败或假通过",
    when: "verify 没有通过,或命令成功但 report 没覆盖目标 feature/scenario。",
    action: "先看 report_fresh、bdd_coverage、missing_scenarios 和 non_passed_scenarios。",
    prepare: [
      "确认 bdd.cmd 是否真的接收了 {feature}",
      "确认 report.path 是本次运行生成",
      "确认每个 Then 都有同等级证据断言",
    ],
    next: [
      "修 runner/step/report 配置,不要只改 feature 文本绕过",
      "verify PASS 后输出 Step Evidence Review",
      "再运行 lint 和 check",
    ],
  });
  if (topic === "tools") return renderTools();
  if (topic === "discover") return renderDiscoverGuide();
  if (topic === "contract" || topic === "feature") return renderContractGuide();
  if (topic === "harness-yaml") return renderHarnessYamlGuide();
  if (topic === "capability-map") return renderCapabilityMapGuide();
  if (topic === "sources") return renderSourcesGuide();
  if (topic === "bdd") return renderBddGuide();
  if (topic === "lint") return renderLintGuide();
  if (topic === "agent-skills") return renderAgentSkillsGuide();
  if (topic === "check") return renderCheckGuide();
  const tool = findToolHelp(topic);
  if (tool) return renderToolHelp(tool);
  return `未知 guide topic: ${topic}\n可用 topic: ${allTopics().join(", ")}`;
}

function renderOverview(): string {
  return [
    "harness-mcp guide",
    "",
    "harness-mcp 是面向 AI 协作开发的业务契约治理层。它不替代 Cucumber/behave/godog,只负责让 AI 先发现业务规则,再写可执行业务契约,最后用 report 和治理检查证明交付没有偏离契约。",
    "",
    "最短路径:",
    "  1. 新项目: guide({ topic: \"new-project\" }) -> init -> project_context",
    "  2. 旧项目: guide({ topic: \"legacy-project\" }) -> init -> project_context -> discover",
    "  3. 新业务: read_source/read_contract -> discover -> 人工确认 -> contract",
    "  4. 改完: verify -> Step Evidence Review -> lint -> check",
    "",
    "遇到 schema 错误:",
    "  不要盲猜 YAML 结构。先调用对应 guide topic,再用工具参数修复。",
    "  capability-map.yaml 错误: guide({ topic: \"capability-map\" }) -> contract({ ..., map_content: \"<完整正确 YAML>\" })",
    "  harness.yaml 错误: guide({ topic: \"harness-yaml\" }) -> 修正 harness.yaml -> project_context/check",
    "",
    "核心流程:",
    "  init -> project_context -> discover -> 人工确认 -> contract -> Feature Contract Review -> 写测试和实现 -> verify -> Step Evidence Review -> lint -> check",
    "",
    "公开工具:",
    ...TOOL_CATALOG.map((tool) => `  - ${tool.name}: ${tool.description}`),
    "",
    "默认写中文 Gherkin: # language: zh-CN。也可以在 harness.yaml 配置 language: en 后使用英文 Gherkin。",
  ].join("\n");
}

function renderWorkflow(): string {
  return [
    "推荐工作流",
    "",
    "新需求:",
    "  init(首次接入) -> PRD/用户描述/source -> discover 输出业务发现包 -> 人工确认 -> contract 写 map + feature -> 写测试和实现 -> verify/lint/check",
    "",
    "已有代码补契约:",
    "  入口方法/API/Consumer/Job -> discover 读取调用链并推导业务规则 -> 人工确认 -> contract 补 feature 和测试 -> verify/lint/check",
    "",
    "纯重构:",
    "  feature 不变 -> 改代码 -> verify/lint/check",
    "",
    "判断标准:",
    "  init 负责创建最小结构,不生成业务 feature。",
    "  discover 负责防止 AI 只写接口成功。",
    "  contract 负责防止 Rule-less feature 和空泛 Then 落盘。",
    "  verify 负责证明本次 BDD report 覆盖目标 feature 且全部场景 passed。",
    "  lint 负责执行 harness/lint/rules.yaml 自定义禁用规则和宿主项目 lint 命令。",
    "  Step Evidence Review 负责证明每个 Then 被同等级断言验证。",
    "  sources 负责让每条 Rule/Scenario 能追溯到 PRD、人工确认、代码推断或其他来源。",
  ].join("\n");
}

function renderScenarioGuide(input: {
  title: string;
  when: string;
  action: string;
  prepare: string[];
  next: string[];
}): string {
  return [
    input.title,
    "",
    "什么时候用:",
    `  ${input.when}`,
    "",
    "现在该调用:",
    `  ${input.action}`,
    "",
    "需要准备:",
    ...input.prepare.map((item) => `  - ${item}`),
    "",
    "下一步:",
    ...input.next.map((item) => `  - ${item}`),
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
    "  - 来源文档: 进入 feature 的业务承诺应沉淀到 harness/sources/YYYY-MM-DD-xxx.md",
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
    "  - capability id 使用 <target>.<domain>.<action>,target 必须在 harness.yaml targets 中声明",
    "  - capability 文件放在 features/<target>/<domain>/;flow 文件放在 flows/<target>/<domain>/",
    "  - language 缺省 zh-CN;配置 language: en 时,feature 头必须写 # language: en",
    "  - 中文必填段落: 意图 / 边界 / 待确认",
    "  - 英文必填段落: Intent / Boundaries / To Confirm",
    "  - Scenario/场景 必须写在 Rule/规则 下,禁止顶层场景",
    "",
    "```gherkin",
    "# language: zh-CN",
    "# capability: api.order.create",
    "# entrypoint: OrderController#create",
    "@order",
    "",
    "功能: 创建订单",
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
    "    # sources:",
    "    #   current: sources/2026-05-08-code-inference-order-create.md#有库存商品可以创建订单",
    "    #   timeline:",
    "    #     - sources/2026-05-08-code-inference-order-create.md#有库存商品可以创建订单",
    "",
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

function renderSourcesGuide(): string {
  return [
    "sources: 业务来源追溯",
    "",
    "来源文档统一放在 harness/sources/。它可以是 PRD、人工确认、会议纪要、工单、代码推断或现有测试推断。PRD 不是必需的,但进入 feature 的业务承诺必须能追到来源。",
    "",
    "目录:",
    "  harness/sources/YYYY-MM-DD-xxx.md",
    "",
    "source 文件不需要 frontmatter。建议用 Markdown 标题和章节表达内容:",
    "",
    "```md",
    "# 创建订单规则代码推断",
    "",
    "## 优惠计算失败",
    "",
    "从 OrderService#create 推断: 优惠失败时不创建订单,不锁库存。",
    "```",
    "",
    "feature 中只允许这一种固定注释块:",
    "",
    "```gherkin",
    ...SOURCE_BLOCK_TEMPLATE.split("\n"),
    "```",
    "",
    "规则:",
    "  - sources 注释块放在 Rule/规则 下;如果某个场景来源不同,可以放在 Scenario/场景 下",
    "  - current 必须出现在 timeline 中",
    "  - timeline 按 source 文件日期从旧到新排列",
    "  - 引用路径必须是 sources/YYYY-MM-DD-xxx.md 或 sources/YYYY-MM-DD-xxx.md#章节",
    "  - contract 写入前硬校验;check 会全量扫描防止手写绕过",
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
    "修复原则:",
    "  - 不要盲猜 YAML 结构,不要一个格式一个格式试",
    "  - 先按下面 schema 生成完整 capability-map.yaml",
    "  - 再调用 contract({ ..., map_content: \"<完整正确 YAML>\" }) 一次性覆盖修复",
    "  - 顶层只能有 version / domains / flows",
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

function renderAgentSkillsGuide(): string {
  return [
    "agent-skills: 项目公共 Agent Skill 存储区",
    "",
    "约定位置:",
    "  harness/agent-skills/<skill-name>/SKILL.md",
    "",
    "边界:",
    "  - 这里只是项目内公共 skill 的保存位置",
    "  - MCP 只在 project_context 中列出索引",
    "  - MCP 不自动加载 skill",
    "  - MCP 不自动安装到 .claude、.codex 或其他客户端目录",
    "  - MCP 不校验 skill 内容格式",
    "  - 是否使用、怎么同步到客户端目录,由用户和团队自己决定",
  ].join("\n");
}

function renderCheckGuide(): string {
  return [
    "check: 静态治理和项目约束",
    "",
    "边界:",
    "  - check 只管 harness 契约治理和 constraints",
    "  - check 不做宿主项目代码风格判断;代码质量请用 lint 和 commands.lint",
    "",
    "check 会检查:",
    "  - feature 缺 # entrypoint",
    "  - feature 缺 Rule/规则",
    "  - Scenario/场景 写在第一个 Rule/规则 前",
    "  - Rule/Scenario 缺少固定 # sources: 来源块",
    "  - sources 文件未按 YYYY-MM-DD-xxx.md 命名",
    "  - sources timeline 日期倒序或 current 不在 timeline 中",
    "  - Then 写得过于空泛",
    "  - 业务 feature 不在 harness/features/<target>/<domain>/ 下",
    "  - flow 不在 harness/flows/<target>/<domain>/ 下",
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
