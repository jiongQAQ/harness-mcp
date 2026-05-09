import { FastMCP } from "fastmcp";
import {
  ContextInputSchema,
  executeContext,
} from "./tools/context.ts";
import { CheckInputSchema, executeCheck } from "./tools/check.ts";
import { ContractInputSchema, executeContract } from "./tools/contract.ts";
import { DiscoverInputSchema, executeDiscover } from "./tools/discover.ts";
import { HelpInputSchema, executeHelp } from "./tools/help.ts";
import { InitInputSchema, executeInit } from "./tools/init.ts";
import { LintInputSchema, executeLint } from "./tools/lint.ts";
import { ReadInputSchema, executeRead } from "./tools/read.ts";
import { ReadSourceInputSchema, executeReadSource } from "./tools/read_source.ts";
import { VerifyInputSchema, executeVerify } from "./tools/verify.ts";
import { toolDescription } from "./tool_catalog.ts";

export function createServer() {
  const server = new FastMCP({
    name: "harness-mcp",
    version: "0.0.1",
    instructions: [
      "harness-mcp: 业务发现驱动的 BDD 契约层。",
      "",
      "主流程:",
      "  0. 首次接入 → init 创建最小 harness 骨架;不要让 AI 自己发明目录",
      "  1. 新需求/已有代码 → 先 discover,输出业务入口、调用链、业务规则、例子、待确认问题和证据来源",
      "  2. discover PASS → 人工确认 → contract 写 capability-map.yaml 和 Rule-based feature",
      "  3. contract PASS → Feature Contract Review → 再写 BDD steps 和实现",
      "  4. 改完 → verify 跑 capability/flow BDD → Step Evidence Review → check",
      "  5. 交付前 → lint 执行 harness/lint/rules.yaml 自定义禁用规则和宿主项目 lint 命令",
      "",
      "若不知道怎么开始 → guide({ topic: \"new-project\" }) 或 guide({ topic: \"legacy-project\" }),再 init()/project_context()。",
      "若用户问当前项目业务契约 → project_context()/read_contract()。",
      "若用户要查看 PRD、人工确认、代码推断等来源全文 → read_source()。",
      "若用户要新增/补充业务 feature → discover(),不要直接 contract。",
      "若用户担心 AI 写烂代码 → 配置 harness/lint/rules.yaml 或 commands.lint 后运行 lint(),不要用 check 代替代码质量门禁。",
      "",
      "── Feature 文件协议(所有项目硬性遵守) ──",
      "  • 所有新建/修改的 harness .feature 文件按 harness.yaml language 校验;缺省 zh-CN,也可配置 en",
      "  • 头部必须有元数据注释:",
      "      # capability: <target>.<业务域>.<能力名>",
      "      # entrypoint: <业务入口方法或 planned:业务入口>",
      "  • capability id 必须使用 <target>.<domain>.<action>;target 必须在 harness.yaml targets 中声明",
      "  • 中文 feature 必须包含: 意图 / 边界 / 待确认;英文 feature 必须包含: Intent / Boundaries / To Confirm",
      "  • 必须先写 Rule/规则,再写 Scenario/场景;禁止顶层 Scenario/场景",
      "  • 每个 Rule/规则 必须有固定 # sources: 注释块;若单个场景来源不同,可在 Scenario/场景 下覆盖",
      "  • # sources: 只允许 current 和 timeline;current 必须在 timeline 中,路径必须指向 harness/sources/YYYY-MM-DD-xxx.md",
      "  • 禁止只写“接口成功 / 返回完整内容 / 状态码 200”这类浅断言",
      "",
      "── 自审触发协议(不要混用) ──",
      "  • Feature Discovery Review 触发于 discover,用于人工确认前",
      "  • Feature Contract Review 只审 feature 契约,不审 step 实现",
      "  • 触发: contract 写入 feature 后;手动修改 harness .feature 后",
      "  • Step Evidence Review 只审 step 断言证据,不审 feature 划分",
      "  • 触发: 写完或修改 BDD step definitions 后;verify PASS 后、宣称 BDD 有效前",
      "  • Step Evidence Review 也叫 Then-to-Assertion 自审;API 断言不能证明 UI 展示",
      "",
      "── 目录组织 ──",
      "  • harness.yaml 推荐固定 spec_dir: harness,不要让 AI 自己发明 harness/specs 这类目录",
      "  • 全局章程 → charter_dir 下的 Markdown 文件,例如 architecture.md / conventions.md / project-constraints.md",
      "  • 业务来源 → spec_dir/sources/YYYY-MM-DD-xxx.md,可来自 PRD、人工确认、会议、工单、代码推断或现有测试",
      "  • 业务能力 → spec_dir/features/<target>/<domain>/<业务动作>.feature,不要直接放在 harness/<domain>",
      "  • 业务流程 → spec_dir/flows/<target>/<domain>/<流程名>.feature,target 可是 api/web/mobile/thirdparty/e2e 等项目自定义值",
      "  • charter 不写 Gherkin;constraints / flows 使用 .feature 并加匹配 harness.yaml language 的 # language",
      "  • BDD step definitions、runner config、测试代码和报告不写进 spec_dir/harness;它们属于宿主项目 test/build 输出",
      "  • BDD 执行代码推荐 tests-or-src-test/contract/bdd/{runner,config,steps,support}",
      "  • runner 默认一个 suite 一个;steps 按业务域分目录;client/fixture/cleaner/helper 放 support",
      "  • check 会拒绝浅 feature、错误目录和 harness 内 BDD 实现",
      "  • lint 只执行 harness/lint/rules.yaml 自定义禁用规则和宿主项目 lint 命令,不内置代码风格判断",
    ].join("\n"),
  });

  server.addTool({
    name: "guide",
    description: toolDescription("guide"),
    parameters: HelpInputSchema,
    execute: async (input) => executeHelp(input),
  });

  server.addTool({
    name: "init",
    description: toolDescription("init"),
    parameters: InitInputSchema,
    execute: async (input) => executeInit(input),
  });

  server.addTool({
    name: "project_context",
    description: toolDescription("project_context"),
    parameters: ContextInputSchema,
    execute: async (input) => executeContext(input),
  });

  server.addTool({
    name: "discover",
    description: toolDescription("discover"),
    parameters: DiscoverInputSchema,
    execute: async (input) => executeDiscover(input),
  });

  server.addTool({
    name: "contract",
    description: toolDescription("contract"),
    parameters: ContractInputSchema,
    execute: async (input) => executeContract(input),
  });

  server.addTool({
    name: "read_contract",
    description: toolDescription("read_contract"),
    parameters: ReadInputSchema,
    execute: async (input) => executeRead(input),
  });

  server.addTool({
    name: "read_source",
    description: toolDescription("read_source"),
    parameters: ReadSourceInputSchema,
    execute: async (input) => executeReadSource(input),
  });

  server.addTool({
    name: "lint",
    description: toolDescription("lint"),
    parameters: LintInputSchema,
    execute: async (input) => executeLint(input),
  });

  server.addTool({
    name: "verify",
    description: toolDescription("verify"),
    parameters: VerifyInputSchema,
    execute: async (input) => executeVerify(input),
  });

  server.addTool({
    name: "check",
    description: toolDescription("check"),
    parameters: CheckInputSchema,
    execute: async (input) => executeCheck(input),
  });

  return server;
}
