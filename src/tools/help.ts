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
    .describe("帮助主题: 不传返回完整手册;也可传 overview/workflow/tools/map/feature/bdd/check/flow 或工具名"),
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

  if (!topic) return renderFullManual();
  if (topic === "overview") return renderOverview();
  if (topic === "workflow") return renderWorkflow();
  if (topic === "tools") return renderTools();
  if (topic === "map") return renderMapGuide();
  if (topic === "feature") return renderFeatureGuide();
  if (topic === "bdd") return renderBddGuide();
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
  lines.push("这个 MCP 是干什么的:");
  lines.push("  harness-mcp 是给 AI 编程助手用的协作契约层。它把项目里的业务规格、项目约定、验证命令和质量约束暴露给 AI。");
  lines.push("  目标是让 AI 改代码前先读懂业务,把 .feature 当作可执行 BDD 规格,改完后能主动跑验证。");
  lines.push("  它不是测试框架,也不替代 Cucumber/behave/godog;它负责选择目标 .feature、调用宿主项目 BDD runner、解析报告并校验覆盖关系。");
  lines.push("");
  lines.push("help 不读取当前项目,只介绍 harness-mcp 工具怎么用、有什么功能、各命令适合什么场景。");
  lines.push("了解当前项目请用 context/info/doctor;验证当前项目请用 verify/check/flow。");
  lines.push("用户说 harness help / 收到 harness help / 执行 harness help 时,直接返回 help() 的完整 MCP 工具手册,不要总结当前项目,不需要再追问 topic。");
  lines.push("");
  lines.push("默认使用中文: 新建或修改 harness .feature 文件时,写 # language: zh-CN,并使用 功能/场景/假设/当/那么。");
  lines.push("");
  lines.push("第一次使用:");
  lines.push("  1. help() 先看完整手册,理解这个 MCP 的用途和工具边界。");
  lines.push("  2. info() 确认当前项目是否接入 harness.yaml。");
  lines.push("  3. doctor() 静态检查目录、feature 质量、约束和 BDD 验证配置。");
  lines.push("  4. context() 读取项目宪法、能力索引和 AI 使用指引。");
  lines.push("  5. 新增业务先 update_map 固定能力边界,再 create_spec;最后用 verify/run/check/flow 验证。");
  lines.push("");
  lines.push("如果你是 AI:");
  lines.push("  - 用户问 harness help 或这个 MCP 怎么用:只调用 help(),直接给完整手册。");
  lines.push("  - 用户问当前项目情况:调用 info()/doctor()/context(),不要用 help() 猜项目状态。");
  lines.push("  - 用户要改业务:先 read_spec;新增业务先 update_map 再 create_spec;业务变更先 update_spec。");
  lines.push("  - create_spec/update_spec 后必须先做 Feature Contract Review:先审 feature,再写 steps。");
  lines.push("  - 改完后:优先跑 verify/run,再跑 check;涉及用户旅程时跑 flow。");
  lines.push("  - BDD steps 写完或 verify/flow 通过后,必须做 Step Evidence Review/Then-to-Assertion 自审;API 断言不能证明 UI 展示。");
  lines.push("");
  lines.push("两类自审不要混用:");
  lines.push("  - Feature Contract Review 只审 feature 契约:业务能力是否切对、Then 是否可验证、核心承诺是否覆盖。");
  lines.push("  - Step Evidence Review 只审 step 断言证据:实际断言是否证明对应 Then。");
  lines.push("");
  lines.push("MCP 工具清单:");
  for (const tool of TOOL_CATALOG) {
    lines.push(`  - ${tool.name}: ${tool.description}`);
  }
  lines.push("");
  lines.push("第一次使用建议:");
  lines.push("  1. info() 看当前项目有没有接入 harness.yaml");
  lines.push("  2. doctor() 看缺哪些 harness 文件、元数据、feature 质量或 BDD 验证配置");
  lines.push("  3. context() 让 AI 读取项目宪法和业务能力索引");
  lines.push("  4. read_spec() 读已有业务,或 update_map()/create_spec() 新增业务 feature");
  lines.push("  5. verify()/run() 跑业务验证,check() 拦截本次新增低质量代码");
  lines.push("");
  lines.push("常用 topic:");
  lines.push("  help({ topic: \"workflow\" })  查看完整开发闭环");
  lines.push("  help({ topic: \"map\" })       查看 capability-map.yaml 写法");
  lines.push("  help({ topic: \"feature\" })   查看中文业务 feature 写法");
  lines.push("  help({ topic: \"bdd\" })       查看 feature 与 step 对齐写法");
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

function renderFullManual(): string {
  return [
    renderOverview(),
    sectionBreak(),
    renderWorkflow(),
    sectionBreak(),
    renderMapGuide(),
    sectionBreak(),
    renderFeatureGuide(),
    sectionBreak(),
    renderBddGuide(),
    sectionBreak(),
    renderCheckGuide(),
    sectionBreak(),
    renderFlowGuide(),
    sectionBreak(),
    renderTools(),
  ].join("\n");
}

function sectionBreak(): string {
  return "\n\n────────────────────────────────────────\n\n";
}

function renderWorkflow(): string {
  return [
    "推荐工作流",
    "",
    "新增业务:",
    "  用户 PRD/需求 -> update_map -> create_spec -> Feature Contract Review -> 写测试红 -> 写代码 -> verify/check",
    "",
    "业务改动:",
    "  read_spec -> update_spec -> Feature Contract Review -> 改测试红 -> 改代码 -> verify/check",
    "",
    "纯重构:",
    "  feature 不变 -> 改代码 -> verify/check",
    "",
    "闭环判断:",
    "  feature 记录真实业务承诺。",
    "  Feature Contract Review 防止契约写错;Step Evidence Review/Then-to-Assertion 自审防止测试证明错。",
    "  两类自审不要混用:Feature 自审发生在写 steps 前;Step 自审发生在写 steps 后或 verify/flow PASS 后。",
    "  verify 通过 bdd 配置执行 capability .feature,并校验测试报告覆盖目标 feature。",
    "  flow 通过同一套 bdd 配置执行用户旅程 .feature,并校验报告覆盖目标 flow。",
    "  run 只用于普通宿主项目命令,不替代 verify/flow 的 BDD 覆盖校验。",
    "  check 阻止 AI 本次新增低质量代码。",
  ].join("\n");
}

function renderMapGuide(): string {
  return [
    "业务能力 Map 写法",
    "",
    "capability-map.yaml 是业务能力边界设计文件。它先定义业务怎么切,再允许 create_spec 创建具体 feature。",
    "",
    "位置:",
    "  harness/capability-map.yaml",
    "",
    "规则:",
    "  domains.<业务域>.capabilities[] 声明单个业务能力。",
    "  capability.id 必须以业务域开头,例如 billing.createOrder。",
    "  capability.file 必须位于 features/<业务域>/ 下。",
    "  flows[] 声明跨能力用户旅程,file 必须位于 flows/ 下。",
    "  flow.uses 只能引用 map 里已经声明的 capability。",
    "  map 不是 BDD step definitions,不要把 steps 或 runner 配置写进 harness。",
    "",
    "示例:",
    "```yaml",
    "version: 1",
    "domains:",
    "  billing:",
    "    capabilities:",
    "      - id: billing.createOrder",
    "        file: features/billing/create-order.feature",
    "        intent: 用户提交有效订单信息后创建订单",
    "      - id: billing.cancelOrder",
    "        file: features/billing/cancel-order.feature",
    "        intent: 用户取消未完成订单",
    "flows:",
    "  - id: billing.checkout",
    "    file: flows/checkout.feature",
    "    uses:",
    "      - billing.createOrder",
    "```",
    "",
    "用法:",
    "  update_map({ content }) 写入或更新 map。",
    "  create_spec 只接受 map 里声明过且 file 一致的 capability。",
    "  doctor 会校验 map、features 和 flows 是否对齐。",
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
    "业务 feature 是 AI 改代码前必须读取的业务契约,也是 verify 选择和校验的 BDD 目标。它描述业务承诺和边界,不是代码模块说明。",
    "",
    "能力划分规则:",
    "  一个 feature 只承诺一个可独立验证的业务结果。",
    "  同一能力的正常、异常、边界样例写成多个场景。",
    "  多个阶段按顺序编排的用户旅程写到 harness/flows,不要塞进单个业务 feature。",
    "  如果一个 feature 场景过多、核心承诺过多,或标题像流程/全链路/端到端,先拆能力。",
    "  doctor 会用 capabilities.boundary 提示结构过宽的业务 feature。",
    "",
    "必须包含:",
    "  路径: harness/features/<业务域>/<能力>.feature",
    "  # language: zh-CN",
    "  # capability: <业务域>.<能力名>",
    "  顶层 @tag",
    "  业务来源 / 意图 / 边界 / 核心承诺 / 风险 / 待确认",
    "  至少一个 场景:",
    "",
    "Feature Contract Review:",
    "  目标:只审 feature 契约,不审 step 实现。",
    "  触发时机: create_spec/update_spec 写入 feature 后。",
    "  触发时机: 手动修改 harness .feature 后。",
    "  不因为 verify/flow PASS 触发;verify/flow PASS 只触发 Step Evidence Review。",
    "  通过后才写或修改 BDD step definitions。",
    "  这个 review 不靠硬编码关键词,而是按业务契约准则逐项判断。",
    "  检查项:",
    "    - capability 是否只表达一个业务能力。",
    "    - 场景是否描述业务行为,不是实现步骤。",
    "    - Then 必须是可验证的业务结果。",
    "    - 不要把 UI、API、DB、流程混在一个 Then。",
    "    - 业务来源、边界、核心承诺是否互相支持。",
    "    - 每条核心承诺是否至少被一个场景覆盖,或写入待确认。",
    "",
    "Feature Contract Review 自审表:",
    "```text",
    "| 检查项 | 结论 | 证据 | 处理 |",
    "|---|---|---|---|",
    "| 单一能力 | 通过/不通过 | feature 标题、边界、核心承诺 | 不通过则拆能力或改 map |",
    "| 可验证 Then | 通过/不通过 | 每个 Then 的可观测结果 | 不通过则改 Then 或拆场景 |",
    "| 承诺覆盖 | 通过/不通过 | 核心承诺与场景对应关系 | 缺失则补场景或写待确认 |",
    "```",
    "",
    "AI 自审要求:",
    "  新建/修改 feature 后先输出 Feature Contract Review,再写 step definitions。",
    "  如果发现 feature 写成流程、实现步骤或混合断言,先改 feature,不要继续写 steps。",
    "  已经进入 verify/flow 或 step 断言阶段时,不要再把 Step Evidence Review 当作 Feature Contract Review。",
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

function renderBddGuide(): string {
  return [
    "BDD Feature 与 Step 对齐",
    "",
    "Step Evidence Review 是 Step 自审,也叫 Then-to-Assertion 自审。它和 Feature Contract Review 是两件事。",
    "BDD runner 的 PASS 只表示 step 没抛错,不自动证明 Then 的业务语义。AI 写完 steps 或跑完 verify/flow 后,必须做 Step Evidence Review。",
    "",
    "触发时机:",
    "  触发时机: 写完或修改 BDD step definitions 后。",
    "  触发时机: verify/flow PASS 后,宣称 BDD 有效前。",
    "  不因为 create_spec/update_spec 直接触发;那一步触发的是 Feature Contract Review。",
    "",
    "审查边界:",
    "  只审 step 断言证据,不审 feature 划分。",
    "  审查对象是宿主项目测试目录里的 step definitions、实际断言、BDD report 和运行证据。",
    "  如果发现 Then 和断言不匹配,再决定改 feature 的 Then 或补同等级断言。",
    "",
    "核心规则:",
    "  Then 写返回数据,step 才能用 API response 证明。",
    "  Then 写数据库状态,step 必须查 DB 或持久化状态证明。",
    "  Then 写页面展示、面板、按钮、交互状态,step 必须用浏览器 DOM 断言证明。",
    "  Then 写样式、布局、hover、响应式,step 必须用 Playwright 截图、视觉断言或等价浏览器证据证明。",
    "  API 断言不能证明 UI 展示;DB 断言不能证明页面交互;DOM 文案断言不能证明视觉样式。",
    "",
    "正确: API Then",
    "```gherkin",
    "场景: 上传 txt 文件并解析章节",
    "  当 用户上传一个有效 txt 小说文件",
    "  那么 系统返回章节解析结果,包含章节标题、顺序和字数",
    "```",
    "```js",
    "Then(\"系统返回章节解析结果,包含章节标题、顺序和字数\", function () {",
    "  assert.ok(data.chapters.length > 0);",
    "  assert.ok(data.chapters[0].title);",
    "  assert.ok(data.chapters[0].order);",
    "  assert.ok(data.chapters[0].wordCount);",
    "});",
    "```",
    "",
    "正确: UI Then",
    "```gherkin",
    "场景: 上传 txt 文件并展示章节预览",
    "  当 用户上传一个有效 txt 小说文件",
    "  那么 右侧面板展示章节结构化预览",
    "```",
    "```js",
    "Then(\"右侧面板展示章节结构化预览\", async function () {",
    "  await expect(page.getByTestId(\"chapter-preview-panel\")).toBeVisible();",
    "  await expect(page.getByText(\"第一章\")).toBeVisible();",
    "});",
    "```",
    "",
    "错误示例:",
    "```text",
    "Then: 右侧面板展示章节结构化预览",
    "实际断言: fetch('/api/novels/parse') 返回 chapters",
    "结论: 不匹配。API 返回章节数据不能证明页面右侧面板真的展示。",
    "```",
    "",
    "Step Evidence Review / Then-to-Assertion 自审表:",
    "```text",
    "| 场景 | Then 文本 | step 文件 | 实际断言 | 证据来源(API/DB/UI/Visual) | 是否匹配 | 处理 |",
    "|---|---|---|---|---|---|---|",
    "| 上传 txt 文件并展示章节预览 | 右侧面板展示章节结构化预览 | tests/bdd/steps/novel-import.steps.js | 断言 API 返回 chapters | API | 不匹配 | 改 Then 为返回章节数据,或补 Playwright DOM 断言 |",
    "```",
    "",
    "AI 自审要求:",
    "  每次新增或修改 BDD steps 后,先输出 Step Evidence Review 自审表再宣称测试有效。",
    "  每次 verify/flow PASS 后,只能说 BDD runner 通过;必须结合 Step Evidence Review 说明 Then 是否被同等级证据证明。",
    "  发现不匹配时,二选一:改 feature 的 Then 让它匹配实际断言,或补对应级别的 step 断言。",
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
    "  业务 feature 放在 harness/features/<业务域>/**/*.feature。",
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
    "flow 把多个业务能力串成一条用户旅程,用来验证真实链路。它不是单个接口测试,也不是 prompt 承诺。",
    "flow 文件仍然是 .feature,执行时由宿主项目的 BDD runner 保证同一 scenario/world/context 内步骤共享上下文。",
    "",
    "目录关系:",
    "  harness/features/<业务域>/**/*.feature 是单个业务能力,由 verify 验证。",
    "  harness/flows/**/*.feature 是跨能力用户旅程,由 flow 验证。",
    "  BDD step definitions、cucumber.js/behave.ini 等 runner 配置和测试代码写在宿主项目测试目录,不要放到 harness/bdd 或 harness/steps。",
    "  两者都通过 harness.yaml 的 bdd 配置调用宿主项目 BDD runner,不同语言接自己的 BDD 框架。",
    "",
    "harness.yaml 示例:",
    "```yaml",
    "version: 1",
    "spec_dir: harness",
    "bdd:",
    "  runner: cucumber-js",
    "  cmd: \"npx cucumber-js\"",
    "  feature_arg_pattern: '\"{feature}\"'",
    "  name_filter_pattern: '--name \"{name}\"'",
    "  report:",
    "    format: cucumber-json",
    "    path: reports/cucumber.json",
    "```",
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
    "  如果报告没有覆盖选中的 flow feature 和场景,结果会显示 BDD Coverage: FAIL。",
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
