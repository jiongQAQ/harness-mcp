import { FastMCP } from "fastmcp";
import { z } from "zod";
import { CreateSpecInputSchema, executeCreateSpec } from "./tools/create_spec.ts";
import {
  ContextInputSchema,
  executeContext,
} from "./tools/context.ts";
import { CheckInputSchema, executeCheck } from "./tools/check.ts";
import { HelpInputSchema, executeHelp } from "./tools/help.ts";
import {
  ListCapabilitiesInputSchema,
  executeListCapabilities,
} from "./tools/list_capabilities.ts";
import { DoctorInputSchema, executeDoctor } from "./tools/doctor.ts";
import { FlowInputSchema, executeFlow } from "./tools/flow.ts";
import { InfoInputSchema, executeInfo } from "./tools/info.ts";
import { LsInputSchema, executeLs } from "./tools/ls.ts";
import { ReadSpecInputSchema, executeReadSpec } from "./tools/read_spec.ts";
import { RunInputSchema, executeRun } from "./tools/run.ts";
import { SearchInputSchema, executeSearch } from "./tools/search.ts";
import { UpdateMapInputSchema, executeUpdateMap } from "./tools/update_map.ts";
import { UpdateSpecInputSchema, executeUpdateSpec } from "./tools/update_spec.ts";
import { VerifyInputSchema, executeVerify } from "./tools/verify.ts";
import { toolDescription } from "./tool_catalog.ts";

export function createServer() {
  const server = new FastMCP({
    name: "harness-mcp",
    version: "0.0.1",
    instructions: [
      "harness-mcp: AI 协作契约层。",
      "",
      "工作流(强烈建议):",
      "  1. 新增业务 → 先基于用户提供的 PRD/需求 update_map,再 create_spec,再做 Feature Contract Review,再写测试,再写代码",
      "  2. 业务改动 → 先 read_spec/update_spec,再做 Feature Contract Review,再改测试,再改代码",
      "  3. 纯重构 → feature 不变,只用 verify/check 保证行为不变",
      "  4. 改完 → verify(capability?) 跑业务验证,check() 拦 AI 新增低质量改动",
      "",
      "若不知道怎么开始 → help(),再 info()/doctor()/context()",
      "若用户说 harness help / 执行 harness help / harness-mcp 怎么用 / 有哪些工具 → 只调用 help(),直接返回 MCP 工具手册;禁止调用 info/doctor/context/check/verify 去总结当前项目",
      "若用户问当前项目有什么、状态如何 → 用 info()/doctor()/context()/check()/verify()",
      "若不知道有哪些业务能力 → list_capabilities() 或 search(query)",
      "",
      "── Feature 文件协议(所有项目硬性遵守) ──",
      "  • 所有新建/修改的 harness .feature 文件默认中文,必须写 # language: zh-CN",
      "  • 头部必须有元数据注释:",
      "      # capability: <业务域>.<能力名>     (唯一标识,fuzzy 匹配用)",
      "      @<tag1> @<tag2>                    (顶层标签,过滤用)",
      "  • 业务 feature 使用中文 Gherkin: 功能 / 场景 / 假设 / 当 / 那么",
      "  • 一个文件 = 一个业务能力契约,不是代码模块说明",
      "  • 一个业务能力只承诺一个可独立验证的业务结果;多阶段编排放 flows",
      "  • 如果场景/核心承诺过多,或标题像流程/全链路/端到端,先拆能力再创建 feature",
      "  • 新建业务 feature 前必须先在 capability-map.yaml 声明 id/file/intent",
      "  • 必须包含段落: 业务来源 / 意图 / 边界 / 核心承诺 / 风险 / 待确认",
      "  • 业务来源必须标明 PRD / 用户提供 / 人工确认 / 代码推断 / 现有测试",
      "  • create_spec/update_spec 后必须先做 Feature Contract Review:先审 feature,再写 steps",
      "  • Feature 自审检查:单一能力、业务行为、可验证 Then、核心承诺覆盖",
      "  • Then 必须是可验证的业务结果;不要把 UI、API、DB、流程混在一个 Then",
      "",
      "── 自审触发协议(不要混用) ──",
      "  • Feature Contract Review 只审 feature 契约,不审 step 实现",
      "  • 触发: create_spec/update_spec 写入 feature 后;手动修改 harness .feature 后",
      "  • 不触发: verify/flow PASS 不触发 Feature Contract Review",
      "  • Step Evidence Review 只审 step 断言证据,不审 feature 划分",
      "  • 触发: 写完或修改 BDD step definitions 后;verify/flow PASS 后、宣称 BDD 有效前",
      "  • Step Evidence Review 也叫 Then-to-Assertion 自审;API 断言不能证明 UI 展示",
      "",
      "── 目录组织 ──",
      "  • harness.yaml 推荐固定 spec_dir: harness,不要让 AI 自己发明 harness/specs 这类目录",
      "  • 全局规矩 → charter_dir 下,文件名按主题(architecture / conventions / ...)",
      "  • 业务能力 → spec_dir/features/<业务域>/<业务动作>.feature,不要直接放在 harness/<业务域>",
      "  • constraints / flows / charter 也默认中文并加 # language: zh-CN",
      "  • BDD step definitions、runner config、测试代码和报告不写进 spec_dir/harness;它们属于宿主项目 test/build 输出",
      "  • 不要把所有 feature 平铺在一个目录,也不要照搬类名/Service/Handler",
      "  • doctor 会提示已经散落在旧目录下的业务 feature",
      "  • doctor 会拒绝 harness/bdd/steps、cucumber.js 这类 BDD 执行实现进入 harness",
      "  • doctor 会校验 capability-map.yaml 与 features/flows 是否对齐",
    ].join("\n"),
  });

  server.addTool({
    name: "help",
    description: toolDescription("help"),
    parameters: HelpInputSchema,
    execute: async (input) => executeHelp(input),
  });

  server.addTool({
    name: "context",
    description: toolDescription("context"),
    parameters: ContextInputSchema,
    execute: async (input) => executeContext(input),
  });

  server.addTool({
    name: "create_spec",
    description: toolDescription("create_spec"),
    parameters: CreateSpecInputSchema,
    execute: async (input) => executeCreateSpec(input),
  });

  server.addTool({
    name: "list_capabilities",
    description: toolDescription("list_capabilities"),
    parameters: ListCapabilitiesInputSchema,
    execute: async (input) => executeListCapabilities(input),
  });

  server.addTool({
    name: "ls",
    description: toolDescription("ls"),
    parameters: LsInputSchema,
    execute: async (input) => executeLs(input),
  });

  server.addTool({
    name: "info",
    description: toolDescription("info"),
    parameters: InfoInputSchema,
    execute: async (input) => executeInfo(input),
  });

  server.addTool({
    name: "doctor",
    description: toolDescription("doctor"),
    parameters: DoctorInputSchema,
    execute: async (input) => executeDoctor(input),
  });

  server.addTool({
    name: "read_spec",
    description: toolDescription("read_spec"),
    parameters: ReadSpecInputSchema,
    execute: async (input) => executeReadSpec(input),
  });

  server.addTool({
    name: "run",
    description: toolDescription("run"),
    parameters: RunInputSchema,
    execute: async (input) => executeRun(input),
  });

  server.addTool({
    name: "flow",
    description: toolDescription("flow"),
    parameters: FlowInputSchema,
    execute: async (input) => executeFlow(input),
  });

  server.addTool({
    name: "check",
    description: toolDescription("check"),
    parameters: CheckInputSchema,
    execute: async (input) => executeCheck(input),
  });

  server.addTool({
    name: "search",
    description: toolDescription("search"),
    parameters: SearchInputSchema,
    execute: async (input) => executeSearch(input),
  });

  server.addTool({
    name: "update_map",
    description: toolDescription("update_map"),
    parameters: UpdateMapInputSchema,
    execute: async (input) => executeUpdateMap(input),
  });

  server.addTool({
    name: "update_spec",
    description: toolDescription("update_spec"),
    parameters: UpdateSpecInputSchema,
    execute: async (input) => executeUpdateSpec(input),
  });

  server.addTool({
    name: "verify",
    description: toolDescription("verify"),
    parameters: VerifyInputSchema,
    execute: async (input) => executeVerify(input),
  });

  return server;
}
