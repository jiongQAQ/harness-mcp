export interface ToolCatalogEntry {
  name: string;
  group: string;
  description: string;
  useWhen: string;
  commonArgs: string[];
  example: string;
  notes: string[];
}

export const HELP_TOPICS = [
  "overview",
  "workflow",
  "tools",
  "feature",
  "check",
  "flow",
] as const;

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "help",
    group: "入门",
    description: "静态查看 harness-mcp 的工具说明、推荐工作流和中文 feature/check/flow 写法;不读取当前项目。",
    useWhen: "第一次使用、不确定下一步该调什么工具、需要查看 MCP 命令用法时。",
    commonArgs: ["topic: 不传返回完整手册 | overview | workflow | tools | feature | check | flow | <tool_name>", "raw"],
    example: "help({})",
    notes: [
      "help() 一次性返回完整 MCP 工具手册,包含用途、第一次使用步骤和 AI 使用方式;topic 只用于精确查看某一段。",
      "用户说 harness help 时直接返回完整手册,不需要再追问 topic。",
      "help 只介绍 MCP 怎么用,不总结当前项目。",
      "了解当前项目用 context/info/doctor,验证当前项目用 verify/check/flow。",
      "harness 文件默认使用中文,示例都会带 # language: zh-CN。",
    ],
  },
  {
    name: "ls",
    group: "发现项目",
    description: "扫描目录,发现已接入 harness.yaml 的项目。",
    useWhen: "一个工作区里有多个项目,不知道哪个项目接入了 harness 时。",
    commonArgs: ["path", "depth", "raw"],
    example: 'ls({ "path": "/path/to/workspace", "depth": 3 })',
    notes: ["只读,不执行测试。"],
  },
  {
    name: "info",
    group: "发现项目",
    description: "查看当前项目的 harness 接入状态、目录、能力统计、tag 和 BDD 配置。",
    useWhen: "刚接入一个项目,先确认 harness.yaml 和目录是否被识别。",
    commonArgs: ["path", "raw"],
    example: "info({})",
    notes: ["只读,不执行测试。"],
  },
  {
    name: "doctor",
    group: "发现项目",
    description: "静态自检 harness 接入:配置、目录、capability 元数据、feature 质量和 BDD 报告配置。",
    useWhen: "用户不知道缺什么、或刚生成/改完 harness 文件后。",
    commonArgs: ["path", "raw"],
    example: 'doctor({ "raw": true })',
    notes: ["业务 feature 缺 # language: zh-CN 会失败。charter/constraints/flows 缺语言头会警告。"],
  },
  {
    name: "context",
    group: "读业务",
    description: "AI 入口工具:一次性返回项目宪法全文、能力索引和使用指引。",
    useWhen: "AI 准备改业务代码前,先调一次建立项目上下文。",
    commonArgs: ["path", "raw"],
    example: "context({})",
    notes: ["比 info 更重,会读取 charter 和能力索引。"],
  },
  {
    name: "list_capabilities",
    group: "读业务",
    description: "列出所有业务能力 capability,支持按 @tag 或 name 前缀过滤。",
    useWhen: "已经知道项目接入正常,只想轻量定位业务能力。",
    commonArgs: ["path", "tag", "prefix", "raw"],
    example: 'list_capabilities({ "tag": "billing" })',
    notes: ["constraints、flows、_charter 不会被当作业务能力。"],
  },
  {
    name: "search",
    group: "读业务",
    description: "全文搜索所有 .feature,含 charter,返回匹配行和上下文。",
    useWhen: "不确定某个业务词在哪个能力或约束里。",
    commonArgs: ["path", "query", "context_lines", "raw"],
    example: 'search({ "query": "订单编号" })',
    notes: ["只读,适合补上下文。"],
  },
  {
    name: "read_spec",
    group: "读业务",
    description: "读取单个业务能力的 .feature 全文。",
    useWhen: "改某个业务前,先读对应业务契约。",
    commonArgs: ["path", "capability", "raw"],
    example: 'read_spec({ "capability": "billing.createOrder" })',
    notes: ["capability 支持模糊匹配,命中多个会列候选。"],
  },
  {
    name: "create_spec",
    group: "写规格",
    description: "安全创建新的业务能力 .feature 文件,并做去重、路径安全、Gherkin 校验和业务契约质量门禁。",
    useWhen: "新增业务时,先把 PRD/用户需求写成业务 feature,再写测试和代码。",
    commonArgs: ["path", "capability", "file", "content", "raw"],
    example: 'create_spec({ "capability": "billing.createOrder", "file": "billing/create-order.feature", "content": "..." })',
    notes: [
      "content 必须包含 # language: zh-CN。",
      "content 必须包含 # capability: <业务域>.<能力名>,且和参数一致。",
      "业务 feature 必须有 业务来源 / 意图 / 边界 / 核心承诺 / 风险 / 待确认。",
    ],
  },
  {
    name: "update_spec",
    group: "写规格",
    description: "覆盖写入已存在业务能力的 .feature 完整内容,并做 Gherkin 校验和业务契约质量门禁。",
    useWhen: "业务变更时,先改 feature,再改测试和代码。",
    commonArgs: ["path", "capability", "content", "allow_invalid_gherkin"],
    example: 'update_spec({ "capability": "billing.createOrder", "content": "..." })',
    notes: [
      "本工具只能改已有能力,不能新建。",
      "content 必须包含 # language: zh-CN。",
      "allow_invalid_gherkin=true 只用于临时强制写入,慎用。",
    ],
  },
  {
    name: "verify",
    group: "验证",
    description: "执行 bdd 配置验证业务 capability .feature,解析报告并校验报告覆盖目标 feature。",
    useWhen: "改完业务、测试或代码后确认业务验证是否通过。",
    commonArgs: ["path", "capability", "include_diff", "raw"],
    example: 'verify({ "capability": "billing.createOrder" })',
    notes: [
      "默认不返回 git diff。失败后 AI 可以自行查看 diff 和测试日志。",
      "bdd.report 必须覆盖选中的 capability feature,否则视为 BDD Coverage FAIL。",
    ],
  },
  {
    name: "run",
    group: "验证",
    description: "执行 commands.run 普通业务验证命令。",
    useWhen: "需要跑宿主项目已有的非 BDD 通用测试命令时。",
    commonArgs: ["path", "raw"],
    example: "run({})",
    notes: ["适合接宿主项目已有测试命令。"],
  },
  {
    name: "flow",
    group: "验证",
    description: "列出或执行 harness/flows/**/*.feature 里的端到端用户旅程。",
    useWhen: "需要把多个能力串成一条真实用户路径验证时。",
    commonArgs: ["path", "name", "dryRun", "raw"],
    example: 'flow({ "name": "下单", "dryRun": true })',
    notes: [
      "没有 name 时只列出 flow。传 name 时执行 bdd 配置里的宿主项目 BDD runner。",
      "bdd.report 必须覆盖选中的 flow feature 和全部场景,否则视为 BDD Coverage FAIL。",
    ],
  },
  {
    name: "check",
    group: "验证",
    description: "执行项目约束检查。未配置 commands.check 时使用内置通用 lint steps,支持扫描 git diff 新增行。",
    useWhen: "防止 AI 本次修改新增低质量代码、临时代码、硬编码或违反项目红线的写法。",
    commonArgs: ["path", "dryRun", "raw"],
    example: 'check({ "raw": true })',
    notes: [
      "check 不是格式化工具,是项目红线检查。",
      "推荐 spec_dir: harness,约束文件放在 harness/constraints/**/*.feature。",
      "内置 runner 只认识固定句式,自然语言规则会被 doctor 标记为 Unsupported constraint step。",
    ],
  },
];

export function toolDescription(name: string): string {
  return TOOL_CATALOG.find((tool) => tool.name === name)?.description ?? name;
}

export function findToolHelp(name: string): ToolCatalogEntry | null {
  return TOOL_CATALOG.find((tool) => tool.name === name) ?? null;
}
