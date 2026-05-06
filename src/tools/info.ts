/**
 * info — summarize harness-mcp project wiring without executing anything.
 */
import { existsSync } from "node:fs";
import { Glob } from "bun";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";

export const InfoInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type InfoInput = z.infer<typeof InfoInputSchema>;

interface TagSummary {
  tag: string;
  count: number;
}

export async function executeInfo(input: InfoInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);

  if (!loaded) {
    return input.raw
      ? JSON.stringify(
          { error: "no_config", message: `No harness.yaml found at ${root}` },
          null,
          2,
        )
      : `No harness.yaml found at ${root}`;
  }

  const [charterCount, capabilities] = await Promise.all([
    countFeatureFiles(loaded.charterDirAbs),
    discoverCapabilities(
      loaded.projectRoot,
      loaded.specDirAbs,
      loaded.charterDirAbs,
    ),
  ]);

  const tags = summarizeTags(capabilities.flatMap((c) => c.tags));
  const linkedFiles = [
    ...new Set(capabilities.flatMap((c) => c.filesLinked)),
  ].sort();
  const bddCfg = loaded.config.bdd;
  const bdd = bddCfg
    ? {
        configured: true,
        runner: bddCfg.runner,
        cmd: bddCfg.cmd,
        workdir: bddCfg.workdir,
        feature_arg_pattern: bddCfg.feature_arg_pattern,
        name_filter_pattern: bddCfg.name_filter_pattern ?? null,
        report_format: bddCfg.report.format,
        report_path: bddCfg.report.path,
        timeout_ms: bddCfg.timeout_ms,
      }
    : {
        configured: false,
        runner: null,
        cmd: null,
        workdir: null,
        feature_arg_pattern: null,
        name_filter_pattern: null,
        report_format: null,
        report_path: null,
        timeout_ms: null,
      };

  const payload = {
    project_root: loaded.projectRoot,
    config_path: loaded.configPath,
    spec_dir: loaded.specDirAbs,
    charter_dir: loaded.charterDirAbs,
    charter_count: charterCount,
    capability_count: capabilities.length,
    tags,
    linked_files: linkedFiles,
    bdd,
    capabilities: capabilities.map((c) => ({
      name: c.name,
      file: c.fileRel,
      title: c.title,
      tags: c.tags,
      files_linked: c.filesLinked,
      last_modified: c.lastModified,
    })),
  };

  if (input.raw) {
    return JSON.stringify(payload, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Project: ${payload.project_root}`);
  lines.push(`config: ${payload.config_path}`);
  lines.push(`spec_dir: ${payload.spec_dir}`);
  lines.push(`charter_dir: ${payload.charter_dir}`);
  lines.push(`charter_count=${payload.charter_count}`);
  lines.push(`capability_count=${payload.capability_count}`);
  lines.push("");

  lines.push("Tags:");
  if (payload.tags.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of payload.tags) {
      lines.push(`  ${t.tag}: ${t.count}`);
    }
  }
  lines.push("");

  lines.push("Linked files:");
  if (payload.linked_files.length === 0) {
    lines.push("  (none)");
  } else {
    for (const file of payload.linked_files) {
      lines.push(`  ${file}`);
    }
  }
  lines.push("");

  if (payload.bdd.configured) {
    lines.push("BDD: bdd configured");
    lines.push(`  runner: ${payload.bdd.runner}`);
    lines.push(`  cmd: ${payload.bdd.cmd}`);
    lines.push(`  workdir: ${payload.bdd.workdir}`);
    lines.push(`  feature_arg_pattern: ${payload.bdd.feature_arg_pattern}`);
    if (payload.bdd.name_filter_pattern) {
      lines.push(`  name_filter_pattern: ${payload.bdd.name_filter_pattern}`);
    }
    lines.push(
      `  report: ${payload.bdd.report_format ?? "(none)"} ${
        payload.bdd.report_path ?? ""
      }`.trimEnd(),
    );
    lines.push(`  timeout_ms: ${payload.bdd.timeout_ms}`);
  } else {
    lines.push("BDD: not configured");
  }
  lines.push("");

  lines.push("Capabilities:");
  if (payload.capabilities.length === 0) {
    lines.push("  (none)");
  } else {
    for (const cap of payload.capabilities) {
      const tagStr = cap.tags.length ? ` ${cap.tags.join(" ")}` : "";
      lines.push(`  • ${cap.name}${tagStr}`);
      if (cap.title) lines.push(`      ${cap.title}`);
      lines.push(`      → ${cap.file}`);
    }
  }

  return lines.join("\n");
}

async function countFeatureFiles(dirAbs: string): Promise<number> {
  if (!existsSync(dirAbs)) return 0;
  let count = 0;
  const glob = new Glob("**/*.feature");
  for await (const _ of glob.scan({ cwd: dirAbs, onlyFiles: true })) {
    count++;
  }
  return count;
}

function summarizeTags(tags: string[]): TagSummary[] {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
