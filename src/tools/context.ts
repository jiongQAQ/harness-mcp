/**
 * F3 context — 项目宪法全文 + 能力索引(AI 入口工具)
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadCapabilityMap } from "../capability_map.ts";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, type Capability } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";

export const ContextInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
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
          { error: "no_config", message: `No harness.yaml found at ${root}` },
          null,
          2,
        )
      : `No harness.yaml found at ${root}.\n` +
          `创建一个最小配置:\n\n  version: 1\n  spec_dir: harness\n`;
  }

  const charter = await readCharter(loaded.charterDirAbs, loaded.projectRoot);
  const caps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const capabilityMap = await loadCapabilityMap(loaded.specDirAbs);

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
  lines.push("  • 新增业务: 用户提供 PRD/需求 → update_map → create_spec → Feature Contract Review → 写测试红 → 写代码 → verify 绿");
  lines.push("  • 业务改动: read_spec → update_spec → Feature Contract Review → 改测试红 → 改代码 → verify 绿");
  lines.push("  • 纯重构: feature 不变 → verify/check 保证行为不变");
  lines.push("  • 目录约定: harness.yaml 使用 spec_dir: harness,不要创建 harness/specs");
  lines.push("  • 业务 feature 放在 harness/features/<业务域>/<能力>.feature");
  lines.push("  • 新建业务 feature 前先 update_map,让 capability-map.yaml 固定 id/file/intent");
  lines.push("  • 一个业务 feature 只承诺一个可独立验证的业务结果;多阶段编排写 flows");
  lines.push("  • create_spec/update_spec 后先做 Feature Contract Review,再写 BDD steps");
  lines.push("  • Feature Contract Review 只审 feature 契约,不审 step 实现");
  lines.push("  • Feature 自审触发: create_spec/update_spec 写入 feature 后,或手动修改 harness .feature 后");
  lines.push("  • verify/flow PASS 不触发 Feature Contract Review");
  lines.push("  • BDD step definitions 和 runner 配置写在宿主项目测试目录,不要写进 harness/");
  lines.push("  • Step Evidence Review 只审 step 断言证据,不审 feature 划分");
  lines.push("  • Step 自审触发: BDD steps 写完/修改后,或 verify/flow PASS 后宣称 BDD 有效前");
  lines.push("  • Step Evidence Review 也叫 Then-to-Assertion 自审");
  lines.push("  • Then 写 UI 展示时必须有浏览器/DOM/视觉断言,API 断言不能证明 UI 展示");
  lines.push("  • harness .feature 默认中文,新建/修改时必须包含 # language: zh-CN");
  lines.push("  • feature 必须包含: 业务来源 / 意图 / 边界 / 核心承诺 / 风险 / 待确认");
  lines.push("  • check() 用于拦截本次 AI 新增低质量改动");

  return lines.join("\n");
}

async function readCharter(
  charterDirAbs: string,
  projectRoot: string,
): Promise<CharterFile[]> {
  if (!existsSync(charterDirAbs)) return [];
  const glob = new Glob("**/*.feature");
  const files: CharterFile[] = [];
  for await (const rel of glob.scan({ cwd: charterDirAbs, onlyFiles: true })) {
    const abs = `${charterDirAbs}/${rel}`;
    const content = await readFile(abs, "utf-8");
    files.push({ fileRel: relative(projectRoot, abs), content });
  }
  files.sort((a, b) => a.fileRel.localeCompare(b.fileRel));
  return files;
}
