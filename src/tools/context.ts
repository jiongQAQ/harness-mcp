/**
 * F3 context — 项目宪法全文 + 能力索引(AI 入口工具)
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
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

  if (input.raw) {
    return JSON.stringify(
      {
        project_root: loaded.projectRoot,
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
  lines.push("  • read_spec(<capability>) — 读单个能力全文");
  lines.push("  • search(<query>)         — 全文搜索");
  lines.push("  • update_spec(...)        — 改规格(改实现前先做这步)");
  lines.push("  • verify(<capability?>)   — 跑测试 + git diff");

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
