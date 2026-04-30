import { FastMCP } from "fastmcp";
import { z } from "zod";
import { CreateSpecInputSchema, executeCreateSpec } from "./tools/create_spec.ts";
import {
  ContextInputSchema,
  executeContext,
} from "./tools/context.ts";
import { CheckInputSchema, executeCheck } from "./tools/check.ts";
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

export function createServer() {
  const server = new FastMCP({
    name: "harness-mcp",
    version: "0.0.1",
    instructions: [
      "harness-mcp: AI 协作契约层。",
      "",
      "工作流(强烈建议):",
      "  1. 改业务代码前 → 调 context() 拿项目宪法 + 能力地图",
      "  2. 锁定要改的能力 → 调 read_spec(capability) 拿契约全文",
      "  3. 先改契约(规格+示例) → update_spec(capability, new_content)",
      "  4. 再改实现代码",
      "  5. 调 verify(capability) 跑测试,看哪些业务语义被破坏",
      "",
      "若不知道有哪些能力 → list_capabilities() 或 search(query)",
      "",
      "── Feature 文件协议(所有项目硬性遵守) ──",
      "  • 头部必须有元数据注释:",
      "      # capability: <业务域>.<能力名>     (唯一标识,fuzzy 匹配用)",
      "      # files: <相对路径>:<行号区间>     (关联代码,可多行)",
      "      @<tag1> @<tag2>                    (顶层标签,过滤用)",
      "  • 用 Gherkin 语法,中文请加 # language: zh-CN",
      "  • 一个文件 = 一个能力(规格 + 示例合并)",
      "",
      "── 目录组织(默认建议,可被项目 charter 覆盖) ──",
      "  • 全局规矩 → charter_dir 下,文件名按主题(architecture / conventions / ...)",
      "  • 业务能力 → spec_dir 下,深度 2-3 层,推荐:",
      "      <业务域>/<接口或聚合>/<方法或动作>.feature",
      "  • 不要把所有 feature 平铺在一个目录 — 业务一多就爆",
      "  • 项目可在 charter 中明确自己的目录约定,覆盖本默认",
    ].join("\n"),
  });

  server.addTool({
    name: "ping",
    description: "健康检查,返回 pong",
    parameters: z.object({}),
    execute: async () => "pong",
  });

  server.addTool({
    name: "context",
    description:
      "AI 入口工具 — 一次性返回项目宪法全文 + 所有能力索引 + AI 使用指引。" +
      "改业务代码前必调一次。",
    parameters: ContextInputSchema,
    execute: async (input) => executeContext(input),
  });

  server.addTool({
    name: "create_spec",
    description:
      "安全创建新的业务能力 .feature 文件。AI 提供完整 content;本工具只负责去重、路径安全、# capability 匹配和 Gherkin 校验。",
    parameters: CreateSpecInputSchema,
    execute: async (input) => executeCreateSpec(input),
  });

  server.addTool({
    name: "list_capabilities",
    description:
      "列出所有能力(capability),支持按 @tag 或 name 前缀过滤。" +
      "比 context 更轻量,适合二次定位。",
    parameters: ListCapabilitiesInputSchema,
    execute: async (input) => executeListCapabilities(input),
  });

  server.addTool({
    name: "ls",
    description:
      "扫描目录,发现已接入 harness.yaml 的项目。返回项目路径、能力数量、charter 数量和 verify 是否配置。" +
      "只读,不执行测试。",
    parameters: LsInputSchema,
    execute: async (input) => executeLs(input),
  });

  server.addTool({
    name: "info",
    description:
      "查看当前项目的 harness 接入状态:配置路径、规格目录、charter/capability 统计、tag、关联文件、verify 配置。" +
      "只读,不执行测试。",
    parameters: InfoInputSchema,
    execute: async (input) => executeInfo(input),
  });

  server.addTool({
    name: "doctor",
    description:
      "静态自检当前项目的 harness 接入:检查 harness.yaml、目录、capability 元数据、重复能力名、verify 报告解析支持。" +
      "只读,不执行测试。",
    parameters: DoctorInputSchema,
    execute: async (input) => executeDoctor(input),
  });

  server.addTool({
    name: "read_spec",
    description:
      "读单个能力的 .feature 全文。capability 支持模糊匹配(case-insensitive substring)," +
      "命中多个会列候选。改业务代码前先调这个工具。",
    parameters: ReadSpecInputSchema,
    execute: async (input) => executeReadSpec(input),
  });

  server.addTool({
    name: "run",
    description:
      "执行 harness.yaml 的 commands.run 普通业务验证命令,解析报告并返回通过/失败摘要。" +
      "若未配置 commands.run,会兼容回退到 verify。",
    parameters: RunInputSchema,
    execute: async (input) => executeRun(input),
  });

  server.addTool({
    name: "flow",
    description:
      "列出或执行端到端用户旅程。默认扫描 harness/flows/**/*.feature;传 name 时执行 commands.flow。" +
      "支持 dryRun 只展示命令。",
    parameters: FlowInputSchema,
    execute: async (input) => executeFlow(input),
  });

  server.addTool({
    name: "check",
    description:
      "执行项目约束检查。默认扫描 harness/constraints/**/*.feature;dryRun 只列出约束。" +
      "未配置 commands.check 时使用内置通用 lint steps,支持扫描 git diff 新增行;" +
      "已配置时运行宿主项目 commands.check。",
    parameters: CheckInputSchema,
    execute: async (input) => executeCheck(input),
  });

  server.addTool({
    name: "search",
    description:
      "全文搜索所有 .feature(含 charter),返回匹配行 + 上下文。" +
      "适用于:不确定哪个能力涉及某关键词时。",
    parameters: SearchInputSchema,
    execute: async (input) => executeSearch(input),
  });

  server.addTool({
    name: "update_spec",
    description:
      "覆盖写入已存在能力的 .feature 完整内容(整文件 rewrite)。" +
      "默认会做 Gherkin 语法校验,失败拒绝写入。" +
      "工作流:改业务代码前先用本工具更新规格,再改代码。" +
      "新增能力时,文件路径建议:<spec_dir>/<业务域>/<接口或聚合>/<方法>.feature(深度 2-3 层)," +
      "项目 charter 若有覆盖约定,以 charter 为准。",
    parameters: UpdateSpecInputSchema,
    execute: async (input) => executeUpdateSpec(input),
  });

  server.addTool({
    name: "verify",
    description:
      "执行 harness.yaml 配的 verify.cmd(spawn 子进程),解析报告,顺带返回 git diff HEAD。" +
      "传 capability 可只跑某个能力的场景(走 filter_pattern 占位符替换)。",
    parameters: VerifyInputSchema,
    execute: async (input) => executeVerify(input),
  });

  return server;
}
