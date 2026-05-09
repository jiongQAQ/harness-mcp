/**
 * context — 项目章程全文 + 能力索引(AI 入口工具)
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";
import { discoverAgentSkills } from "../agent_skills.ts";
import { loadCapabilityMap } from "../capability_map.ts";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import { discoverCapabilities } from "../capability.ts";
import { scanFiles } from "../glob.ts";
import { resolveProjectRoot } from "../project.ts";
import { discoverSources } from "../sources.ts";

export const ContextInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则从当前目录向上查找 harness.yaml 或 .git"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type ContextInput = z.infer<typeof ContextInputSchema>;

interface CharterFile {
  fileRel: string;
  content: string;
}

export async function executeContext(input: ContextInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);

  if (!loaded) {
    return input.raw
      ? JSON.stringify(
          { error: "no_config", message: formatMissingHarnessConfig(root) },
          null,
          2,
        )
      : formatMissingHarnessConfig(root);
  }

  const charter = await readCharter(loaded.charterDirAbs, loaded.projectRoot);
  const agentSkills = await discoverAgentSkills(loaded.projectRoot, loaded.specDirAbs);
  const sources = await discoverSources(loaded.projectRoot, loaded.specDirAbs);
  const caps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const capabilityMap = await loadCapabilityMap(loaded.specDirAbs, loaded.config.targets);

  if (input.raw) {
    return JSON.stringify(
      {
        project_root: loaded.projectRoot,
        capability_map:
          !capabilityMap.exists
            ? null
            : capabilityMap.ok
              ? {
                  capabilities: capabilityMap.capabilities,
                  flows: capabilityMap.flows,
                }
              : { error: capabilityMap.error },
        charter: charter.map((c) => ({ file: c.fileRel, content: c.content })),
        agent_skills: agentSkills,
        sources: sources.map((source) => ({
          file: source.fileRel,
          spec_file: source.specRel,
          title: source.title,
          date: source.date,
          valid_date_name: source.validDateName,
        })),
        capabilities: caps.map((c) => ({
          name: c.name,
          file: c.fileRel,
          title: c.title,
          tags: c.tags,
          files_linked: c.filesLinked,
          last_modified: c.lastModified,
        })),
        ai_hints: loaded.config.ai_hints ?? null,
      },
      null,
      2,
    );
  }

  // 格式化文本
  const lines: string[] = [];
  lines.push(`# Project: ${loaded.projectRoot}`);
  lines.push("");

  // Charter
  if (charter.length === 0) {
    lines.push("── Charter ── (empty)");
  } else {
    lines.push(`── Charter (${charter.length} files) ──`);
    for (const c of charter) {
      lines.push("");
      lines.push(`### ${c.fileRel}`);
      lines.push("");
      lines.push(c.content.trimEnd());
    }
  }
  lines.push("");

  // Agent skills
  if (agentSkills.length > 0) {
    lines.push(`── Agent Skills (${agentSkills.length}) ──`);
    for (const skill of agentSkills) {
      lines.push(`  • ${skill.name}`);
      if (skill.description) lines.push(`      ${skill.description}`);
      lines.push(`      → ${skill.file}`);
    }
    lines.push("");
  }

  // Sources
  if (sources.length > 0) {
    lines.push(`── Sources (${sources.length} files) ──`);
    for (const source of sources) {
      lines.push(`  • ${source.specRel}`);
      lines.push(`      title: ${source.title}`);
      if (!source.validDateName) lines.push("      invalid: expected sources/YYYY-MM-DD-xxx.md");
    }
    lines.push("");
  }

  // Capability map
  if (!capabilityMap.exists) {
    lines.push("── Capability Map ── (missing)");
  } else if (!capabilityMap.ok) {
    lines.push("── Capability Map ── (invalid)");
    lines.push(`  ${capabilityMap.error}`);
  } else {
    lines.push(
      `── Capability Map (${capabilityMap.capabilities.length} capabilities, ${capabilityMap.flows.length} flows) ──`,
    );
    for (const capability of capabilityMap.capabilities) {
      lines.push(`  • ${capability.id}`);
      lines.push(`      ${capability.file}`);
      lines.push(`      ${capability.intent}`);
    }
    if (capabilityMap.flows.length > 0) {
      lines.push("");
      lines.push("  Flows:");
      for (const flow of capabilityMap.flows) {
        lines.push(`  • ${flow.id} -> ${flow.file}`);
        if (flow.uses.length > 0) lines.push(`      uses: ${flow.uses.join(", ")}`);
      }
    }
  }
  lines.push("");

  // Capabilities
  lines.push(`── Capabilities (${caps.length}) ──`);
  for (const cap of caps) {
    const tagStr = cap.tags.length ? ` ${cap.tags.join(" ")}` : "";
    lines.push(`  • ${cap.name}${tagStr}`);
    if (cap.title) lines.push(`      ${cap.title}`);
    lines.push(`      → ${cap.fileRel}`);
  }

  // AI hints
  if (loaded.config.ai_hints) {
    lines.push("");
    lines.push("── AI Hints ──");
    lines.push(loaded.config.ai_hints.trimEnd());
  }

  // 引导
  lines.push("");
  lines.push("── How to use ──");
  lines.push("  • 首次接入: guide({ topic: \"new-project\" }) 或 guide({ topic: \"legacy-project\" }) → init → project_context");
  lines.push("  • 新增业务/已有代码补契约: PRD/入口方法 → discover → 人工确认 → contract → Feature Contract Review → 写测试和实现 → verify → Step Evidence Review → lint → check");
  lines.push("  • 纯重构: feature 不变 → verify/lint/check 保证行为和代码质量");
  lines.push("  • 目录约定: harness.yaml 使用 spec_dir: harness,不要创建 harness/specs");
  lines.push("  • 全局章程放在 harness/_charter/*.md,用于架构、命名、模块边界和编码约定");
  lines.push("  • harness.yaml 必须声明 targets;target 是验证目标,例如 api/web/mobile/thirdparty/e2e");
  lines.push("  • 业务 feature 放在 harness/features/<target>/<domain>/<能力>.feature");
  lines.push("  • flow 放在 harness/flows/<target>/<domain>/<流程>.feature");
  lines.push("  • 新建业务 feature 前先 discover,让 AI 输出业务入口、调用链、业务规则、例子、证据来源和真正无法从材料判断的待确认问题");
  lines.push("  • AI 提待确认问题前必须先查 PRD、代码、配置、枚举、注释、调用链和现有测试;能回答的先写入已确认规则");
  lines.push("  • 编写或修改 .feature 前先调用 guide({ topic: \"gherkin-official\" }),对齐 Cucumber 官方结构和 harness 模板");
  lines.push("  • capability-map.yaml 固定 id/file/entrypoint/intent;id 使用 <target>.<domain>.<action>");
  lines.push("  • 一个业务 feature 只承诺一个可独立验证的业务结果;多阶段编排写 flows");
  lines.push("  • feature 必须有 # entrypoint,并使用 Rule/规则 分组");
  lines.push("  • contract 后先做 Feature Contract Review,再写 BDD steps");
  lines.push("  • Feature Contract Review 只审 feature 契约,不审 step 实现");
  lines.push("  • verify PASS 不触发 Feature Contract Review");
  lines.push("  • BDD step definitions 和 runner 配置写在宿主项目测试目录,不要写进 harness/");
  lines.push("  • BDD 执行代码推荐 tests-or-src-test/contract/bdd/{runner,config,steps,support}");
  lines.push("  • runner 默认一个 suite 一个;steps 必须按业务域分目录;API client/fixture/cleaner/helper 放 support");
  lines.push("  • 禁止把 *Steps、*RunnerTest、*Config 平铺在 bdd 根目录");
  lines.push("  • Step Evidence Review 只审 step 断言证据,不审 feature 划分");
  lines.push("  • Step 自审触发: BDD steps 写完/修改后,或 verify PASS 后宣称 BDD 有效前");
  lines.push("  • Step Evidence Review 也叫 Then-to-Assertion 自审");
  lines.push("  • Then 写 UI 展示时必须有浏览器/DOM/视觉断言,API 断言不能证明 UI 展示");
  lines.push("  • lint() 用于执行 harness/lint/rules.yaml 自定义禁用规则和宿主项目 lint 命令");
  lines.push("  • harness/lint/rules.yaml 是行级正则禁用规则;跨行语义检查应接入 commands.lint");
  lines.push("  • 项目公共 Agent Skills 可保存在 harness/agent-skills/<skill-name>/SKILL.md;MCP 只列索引,不自动加载或安装");
  lines.push("  • 业务来源文档放在 harness/sources/YYYY-MM-DD-xxx.md;可来自 PRD、人工确认、会议、工单、代码推断或现有测试");
  lines.push("  • # sources: 可在 feature 文件头统一声明默认来源;Rule/Scenario 只有来源不同时才写局部覆盖");
  lines.push("  • harness.yaml language 缺省 zh-CN,可配置 en;feature 文件头必须匹配 # language");
  lines.push("  • 中文 feature 必须包含: 意图 / 边界 / 待确认;英文 feature 必须包含: Intent / Boundaries / To Confirm");
  lines.push("  • Scenario/场景 必须写在 Rule/规则 下,禁止顶层场景");
  lines.push("  • 禁止空泛 Then: 应返回成功 / 应返回完整内容 / 接口调用成功 / 状态码 200");
  lines.push("  • check() 用于拦截 harness 契约质量和治理问题");

  return lines.join("\n");
}

async function readCharter(
  charterDirAbs: string,
  projectRoot: string,
): Promise<CharterFile[]> {
  if (!existsSync(charterDirAbs)) return [];
  const files: CharterFile[] = [];
  for (const rel of await scanFiles(charterDirAbs, "**/*.md")) {
    const abs = `${charterDirAbs}/${rel}`;
    const content = await readFile(abs, "utf-8");
    files.push({ fileRel: relative(projectRoot, abs), content });
  }
  files.sort((a, b) => a.fileRel.localeCompare(b.fileRel));
  return files;
}
