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
  "new-project",
  "legacy-project",
  "new-feature",
  "change-feature",
  "frontend-backend-e2e",
  "verify-failed",
  "gherkin-official",
  "tools",
  "init",
  "discover",
  "contract",
  "harness-yaml",
  "capability-map",
  "sources",
  "feature",
  "bdd",
  "lint",
  "agent-skills",
  "check",
] as const;

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    name: "guide",
    group: "入门",
    description: "查看 harness-mcp 的工具说明、业务发现流程和 BDD 契约写法;不读取当前项目。",
    useWhen: "第一次使用、不确定下一步该调什么工具、需要查看 MCP 命令用法时。",
    commonArgs: ["topic", "raw"],
    example: "guide({})",
    notes: ["guide 只介绍 MCP 怎么用,不总结当前项目。"],
  },
  {
    name: "init",
    group: "入门",
    description: "为新项目、旧项目或子仓库创建最小 harness 目录和配置骨架。",
    useWhen: "项目第一次接入 harness-mcp,或子仓库需要 workspace.target 限制时。",
    commonArgs: ["path", "mode", "targets", "target", "overwrite", "raw"],
    example: 'init({ "mode": "workspace", "targets": ["api", "web", "e2e"], "target": "api" })',
    notes: ["只初始化骨架,不自动生成业务 feature。业务契约必须先 discover,人工确认后再 contract。", "默认写入空 lint rules,不会生成 no-try-catch 等项目专属规则。"],
  },
  {
    name: "project_context",
    group: "读上下文",
    description: "读取项目章程、来源索引、能力地图、已有业务契约和 AI 使用指引。",
    useWhen: "AI 准备理解或修改当前项目时先调用。",
    commonArgs: ["path", "raw"],
    example: "project_context({})",
    notes: ["只读。"],
  },
  {
    name: "discover",
    group: "业务发现",
    description: "校验 AI 从 PRD/代码入口/调用链中挖出的业务规则、例子、待确认问题和证据来源。",
    useWhen: "新需求拆能力、或从已有代码补 feature 之前。",
    commonArgs: ["source", "goal", "capability", "entrypoints", "call_chain", "business_rules", "examples", "questions", "evidence", "raw"],
    example: 'discover({ "source": "code", "goal": "客户创建订单", "capability": "api.order.create", "entrypoints": ["OrderController#create"], "call_chain": ["OrderService#create", "InventoryService#reserve"], "business_rules": ["有库存时创建待支付订单并锁定库存"], "examples": ["库存充足创建订单", "库存不足拒绝创建"], "evidence": [{ "source": "code", "detail": "OrderService#create" }] })',
    notes: ["不写文件。通过后需要人工确认,再调用 contract。"],
  },
  {
    name: "contract",
    group: "写契约",
    description: "写入或更新 capability-map.yaml 和 Rule-based .feature 业务契约。",
    useWhen: "业务发现通过并经人工确认后,落地 capability 或 flow 契约。",
    commonArgs: ["path", "kind", "id", "file", "content", "map_content", "raw"],
    example: 'contract({ "kind": "capability", "id": "api.order.create", "file": "features/api/order/create.feature", "content": "...", "map_content": "..." })',
    notes: ["feature 必须有 # entrypoint 和 Rule/规则。成功后触发 Feature Contract Review。"],
  },
  {
    name: "read_contract",
    group: "读契约",
    description: "列出、读取或搜索已有业务契约。",
    useWhen: "需要定位已有 capability、读取 feature 全文或搜索业务词时。",
    commonArgs: ["path", "capability", "query", "raw"],
    example: 'read_contract({ "capability": "api.order.create" })',
    notes: ["只读。"],
  },
  {
    name: "read_source",
    group: "读上下文",
    description: "列出、读取或搜索 harness/sources 下的业务来源文档。",
    useWhen: "AI 需要查看 PRD、人工确认、会议纪要、工单、代码推断等来源全文时。",
    commonArgs: ["path", "file", "query", "raw"],
    example: 'read_source({ "file": "sources/2026-05-08-code-inference-order-create.md" })',
    notes: ["只读。project_context 只列 source 索引,需要全文时再调用 read_source。"],
  },
  {
    name: "verify",
    group: "验证",
    description: "执行 capability 或 flow 的 BDD 验证,并校验本次 report 覆盖目标 feature 和全部场景。",
    useWhen: "契约、测试或实现改完后验证业务行为。",
    commonArgs: ["path", "target_type", "target", "dryRun", "include_diff", "raw"],
    example: 'verify({ "target_type": "capability", "target": "api.order.create" })',
    notes: ["skipped/pending/undefined 不算通过。PASS 后触发 Step Evidence Review。"],
  },
  {
    name: "lint",
    group: "代码质量",
    description: "执行 harness/lint/rules.yaml 自定义禁用规则,并可执行宿主项目 commands.lint。",
    useWhen: "AI 写完代码后、交付前,需要按项目约定执行代码质量门禁。",
    commonArgs: ["path", "scope", "dryRun", "raw"],
    example: 'lint({ "scope": "diff", "raw": true })',
    notes: ["不内置代码风格规则。配置 harness/lint/rules.yaml 后会执行行级正则禁用规则。", "配置 commands.lint 后会同时执行宿主项目 lint 命令。"],
  },
  {
    name: "check",
    group: "治理",
    description: "静态检查 harness 质量并执行项目约束检查。",
    useWhen: "生成/修改契约后,或交付前检查浅 feature、目录错误和项目约束。",
    commonArgs: ["path", "dryRun", "raw"],
    example: 'check({ "raw": true })',
    notes: ["发现缺 Rule、空泛 Then、业务 feature 放错目录、BDD 实现写进 harness 等问题。"],
  },
];

export function toolDescription(name: string): string {
  return TOOL_CATALOG.find((tool) => tool.name === name)?.description ?? name;
}

export function findToolHelp(name: string): ToolCatalogEntry | null {
  return TOOL_CATALOG.find((tool) => tool.name === name) ?? null;
}
