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
      "  1. 新增业务 → 先基于用户提供的 PRD/需求 create_spec,再写测试,再写代码",
      "  2. 业务改动 → 先 read_spec/update_spec,再改测试,再改代码",
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
      "  • 必须包含段落: 业务来源 / 意图 / 边界 / 核心承诺 / 风险 / 待确认",
      "  • 业务来源必须标明 PRD / 用户提供 / 人工确认 / 代码推断 / 现有测试",
      "",
      "── 目录组织(默认建议,可被项目 charter 覆盖) ──",
      "  • harness.yaml 推荐固定 spec_dir: harness,不要让 AI 自己发明 harness/specs 这类目录",
      "  • 全局规矩 → charter_dir 下,文件名按主题(architecture / conventions / ...)",
      "  • 业务能力 → spec_dir 下按业务域/业务动作组织,不要照搬类名/Service/Handler",
      "  • constraints / flows / charter 也默认中文并加 # language: zh-CN",
      "  • 不要把所有 feature 平铺在一个目录 — 业务一多就爆",
      "  • 项目可在 charter 中明确自己的目录约定,覆盖本默认",
    ].join("\n"),
  });

  server.addTool({
    name: "ping",
    description: toolDescription("ping"),
    parameters: z.object({}),
    execute: async () => "pong",
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
