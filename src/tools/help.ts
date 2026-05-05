import { z } from "zod";
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
    .describe("帮助主题: overview/workflow/tools/feature/check/flow 或工具名"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type HelpInput = z.infer<typeof HelpInputSchema>;

export async function executeHelp(input: HelpInput): Promise<string> {
  const topic = normalizeTopic(input.topic);
  if (input.raw) {
    return JSON.stringify(
      {
        default_language: "zh-CN",
        topics: allTopics(),
        tools: TOOL_CATALOG,
      },
      null,
      2,
    );
  }

  if (!topic || topic === "overview") return renderOverview();
  if (topic === "workflow") return renderWorkflow();
  if (topic === "tools") return renderTools();
  if (topic === "feature") return renderFeatureGuide();
  if (topic === "check") return renderCheckGuide();
  if (topic === "flow") return renderFlowGuide();

  const tool = findToolHelp(topic);
  if (tool) return renderToolHelp(tool);

  return renderUnknownTopic(topic);
}

function normalizeTopic(topic?: string): string {
  return topic?.trim().toLowerCase() ?? "";
}

function renderOverview(): string {
  const lines: string[] = [];
  lines.push("harness-mcp help");
  lines.push("");
  lines.push("help 不读取当前项目,只介绍 harness-mcp 工具怎么用、有什么功能、各命令适合什么场景。");
  lines.push("了解当前项目请用 context/info/doctor;验证当前项目请用 verify/check/flow。");
  lines.push("用户说 harness help / 执行 harness help 时,只返回这份 MCP 工具手册,不要总结当前项目。");
  lines.push("");
  lines.push("默认使用中文: 新建或修改 harness .feature 文件时,写 # language: zh-CN,并使用 功能/场景/假设/当/那么。");
  lines.push("");
  lines.push("MCP 工具清单:");
  for (const tool of TOOL_CATALOG) {
    lines.push(`  - ${tool.name}: ${tool.description}`);
  }
  lines.push("");
  lines.push("第一次使用建议:");
  lines.push("  1. info() 看当前项目有没有接入 harness.yaml");
  lines.push("  2. doctor() 看缺哪些 harness 文件、元数据、feature 质量或验证配置");
  lines.push("  3. context() 让 AI 读取项目宪法和业务能力索引");
  lines.push("  4. read_spec() 读已有业务,或 create_spec() 新增业务 feature");
  lines.push("  5. verify()/run() 跑业务验证,check() 拦截本次新增低质量代码");
  lines.push("");
  lines.push("常用 topic:");
  lines.push("  help({ topic: \"workflow\" })  查看完整开发闭环");
  lines.push("  help({ topic: \"feature\" })   查看中文业务 feature 写法");
  lines.push("  help({ topic: \"check\" })     查看 diff-aware 约束写法");
  lines.push("  help({ topic: \"flow\" })      查看端到端用户旅程写法");
  lines.push("  help({ topic: \"tools\" })     查看全部工具");
  lines.push("");
  lines.push("工具分组:");
  for (const [group, tools] of groupTools()) {
    lines.push(`  ${group}: ${tools.map((tool) => tool.name).join(", ")}`);
  }
  return lines.join("\n");
}

function renderWorkflow(): string {
  return [
    "推荐工作流",
    "",
    "新增业务:",
    "  用户 PRD/需求 -> create_spec -> 写测试红 -> 写代码 -> verify/check",
    "",
    "业务改动:",
    "  read_spec -> update_spec -> 改测试红 -> 改代码 -> verify/check",
    "",
    "纯重构:",
    "  feature 不变 -> 改代码 -> verify/check",
    "",
    "闭环判断:",
    "  feature 记录真实业务承诺。",
    "  verify/run 验证业务承诺有没有被实现。",
    "  flow 把多个能力串成用户旅程。",
    "  check 阻止 AI 本次新增低质量代码。",
  ].join("\n");
}

function renderTools(): string {
  const lines = ["全部工具", ""];
  for (const [group, tools] of groupTools()) {
    lines.push(`${group}:`);
    for (const tool of tools) {
      lines.push(`  - ${tool.name}: ${tool.description}`);
    }
    lines.push("");
  }
  lines.push('查看单个工具: help({ topic: "create_spec" })');
  return lines.join("\n").trimEnd();
}

function renderFeatureGuide(): string {
  return [
    "中文业务 Feature 写法",
    "",
    "业务 feature 是 AI 改代码前必须读取的业务契约。它描述业务承诺和边界,不是代码模块说明。",
    "",
    "必须包含:",
    "  # language: zh-CN",
    "  # capability: <业务域>.<能力名>",
    "  顶层 @tag",
    "  业务来源 / 意图 / 边界 / 核心承诺 / 风险 / 待确认",
    "  至少一个 场景:",
    "",
    "示例:",
    "```gherkin",
    "# language: zh-CN",
    "# capability: billing.createOrder",
    "@billing",
    "",
    "功能: 创建订单",
    "",
    "  业务来源:",
    "    - PRD: 用户提供的订单创建需求",
    "",
    "  意图:",
    "    - 为用户创建一笔可追踪的订单。",
    "",
    "  边界:",
    "    - 本能力只定义订单创建的业务承诺,不规定代码类结构。",
    "",
    "  核心承诺:",
    "    - 创建成功后必须返回订单编号。",
    "    - 输入无效时必须显式失败,不能创建默认订单。",
    "",
    "  风险:",
    "    - AI 可能为了跑通而吞掉失败原因。",
    "",
    "  待确认:",
    "    - 无",
    "",
    "  场景: 有效信息创建订单",
    "    假设 用户提交有效订单信息",
    "    当 创建订单",
    "    那么 应返回订单编号",
    "```",
  ].join("\n");
}

function renderCheckGuide(): string {
  return [
    "约束 Check 写法",
    "",
    "check 用来拦截 AI 本次修改新增的低质量代码。内置检查会读取 git diff 新增行,不是把整份 diff 返回给 AI。",
    "",
    "目录约定:",
    "  harness.yaml 推荐固定写 spec_dir: harness。",
    "  约束文件放在 harness/constraints/**/*.feature。",
    "  不要让 AI 自己发明 harness/specs 这类目录；doctor 会提示 config.spec_dir_convention 和 constraints.discoverable。",
    "",
    "内置 check 只认识这些句式:",
    "  假设 扫描本次新增的 \"server/**/*.ts\" 行",
    "  假设 扫描 \"server/**/*.ts\"",
    "  当 匹配到 \"console\\\\.log\"",
    "  那么 应该报错 \"本次修改新增了调试输出\"",
    "  而且 修正方式为 \"删除调试输出；确需日志时使用项目统一 logger\"",
    "  那么 不应该有匹配",
    "  那么 应该存在 / 那么 不应该存在",
    "  当 运行命令 \"npm test\" / 那么 命令应该成功",
    "",
    "不要写成纯自然语言规则。比如“假设 AI 正在编写业务代码 / 那么 不得创建过早抽象”不会执行,doctor/check dryRun 会报告 Unsupported constraint step。",
    "",
    "示例:",
    "```gherkin",
    "# language: zh-CN",
    "@constraint",
    "功能: 本次修改不允许新增低质量代码",
    "",
    "  场景: 本次 TypeScript 修改不应新增调试输出",
    "    假设 扫描本次新增的 \"src/**/*.ts\" 行",
    "    当 匹配到 \"console\\\\.log\"",
    "    那么 应该报错 \"本次修改新增了调试输出\"",
    "    而且 修正方式为 \"删除调试输出；确需日志时使用项目统一 logger\"",
    "```",
    "",
    "适合表达:",
    "  禁止宽泛 catch、禁止硬编码密钥、禁止临时 mock、禁止跨层调用、禁止默认兜底返回。",
    "",
    "如果项目已有 Semgrep、PMD、Checkstyle、ESLint 或架构测试,把它们接到 commands.check 即可。",
  ].join("\n");
}

function renderFlowGuide(): string {
  return [
    "端到端 Flow 写法",
    "",
    "flow 把多个业务能力串成一条用户旅程,用来验证真实链路。它不是单个接口测试。",
    "",
    "示例:",
    "```gherkin",
    "# language: zh-CN",
    "@flow @checkout",
    "功能: 用户完成下单",
    "",
    "  场景: 新用户选择商品并完成支付",
    "    假设 用户已打开商品详情页",
    "    当 用户加入购物车",
    "    而且 用户提交订单",
    "    而且 用户完成支付",
    "    那么 应看到订单编号",
    "    而且 订单状态应为已支付",
    "```",
    "",
    "用法:",
    "  flow() 列出所有用户旅程。",
    "  flow({ name: \"下单\" }) 执行匹配的旅程。",
    "  flow({ name: \"下单\", dryRun: true }) 只看会执行什么命令。",
  ].join("\n");
}

function renderToolHelp(tool: ToolCatalogEntry): string {
  const lines: string[] = [];
  lines.push(`${tool.name}`);
  lines.push("");
  lines.push(tool.description);
  lines.push("");
  lines.push(`使用场景: ${tool.useWhen}`);
  if (tool.commonArgs.length) {
    lines.push(`常用参数: ${tool.commonArgs.join(", ")}`);
  }
  lines.push(`示例: ${tool.example}`);
  if (tool.notes.length) {
    lines.push("");
    lines.push("注意:");
    for (const note of tool.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

function renderUnknownTopic(topic: string): string {
  return [
    `未知 help topic: ${topic}`,
    "",
    `可用 topic: ${allTopics().join(", ")}`,
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
