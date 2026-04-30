/**
 * ls - discover harness-enabled projects under a workspace.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { discoverCapabilities } from "../capability.ts";
import { loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";

export const LsInputSchema = z.object({
  path: z.string().optional().describe("扫描根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  depth: z
    .number()
    .int()
    .min(0)
    .max(12)
    .optional()
    .default(3)
    .describe("向下扫描目录深度,默认 3"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type LsInput = z.infer<typeof LsInputSchema>;

type ProjectStatus = "ok" | "invalid";

interface ProjectSummary {
  status: ProjectStatus;
  project_root: string;
  relative_path: string;
  config_path: string;
  spec_dir: string | null;
  charter_dir: string | null;
  capability_count: number | null;
  charter_count: number | null;
  verify_configured: boolean | null;
  error?: string;
}

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".worktrees",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
]);

export async function executeLs(input: LsInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const depth = input.depth ?? 3;
  const projectRoots = await findHarnessProjects(root, depth);
  const packages = await Promise.all(
    projectRoots.map((projectRoot) => summarizeProject(root, projectRoot)),
  );

  packages.sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  const payload = {
    root,
    depth,
    package_count: packages.length,
    packages,
  };

  if (input.raw) {
    return JSON.stringify(payload, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Harness projects: ${payload.package_count}`);
  lines.push(`root: ${payload.root}`);
  lines.push(`depth: ${payload.depth}`);
  lines.push("");

  if (packages.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }

  for (const pkg of packages) {
    lines.push(`- ${pkg.relative_path}`);
    lines.push(`    status: ${pkg.status}`);
    lines.push(`    config: ${pkg.config_path}`);
    if (pkg.status === "ok") {
      lines.push(
        `    capabilities=${pkg.capability_count} charter=${pkg.charter_count} verify=${
          pkg.verify_configured ? "yes" : "no"
        }`,
      );
    } else {
      lines.push(`    error: ${pkg.error ?? "unknown"}`);
    }
  }

  return lines.join("\n");
}

async function findHarnessProjects(root: string, maxDepth: number): Promise<string[]> {
  const result: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (existsSync(resolve(dir, "harness.yaml"))) {
      result.push(dir);
    }

    if (depth >= maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (shouldSkipDir(entry.name)) continue;
      await walk(resolve(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return result.sort((a, b) => a.localeCompare(b));
}

async function summarizeProject(
  scanRoot: string,
  projectRoot: string,
): Promise<ProjectSummary> {
  const relativePath = relative(scanRoot, projectRoot) || ".";

  try {
    const loaded = await loadConfig(projectRoot);
    if (!loaded) {
      return {
        status: "invalid",
        project_root: projectRoot,
        relative_path: relativePath,
        config_path: resolve(projectRoot, "harness.yaml"),
        spec_dir: null,
        charter_dir: null,
        capability_count: null,
        charter_count: null,
        verify_configured: null,
        error: "harness.yaml not found",
      };
    }

    const [charterCount, capabilities] = await Promise.all([
      countFeatureFiles(loaded.charterDirAbs),
      discoverCapabilities(
        loaded.projectRoot,
        loaded.specDirAbs,
        loaded.charterDirAbs,
      ),
    ]);

    return {
      status: "ok",
      project_root: loaded.projectRoot,
      relative_path: relativePath,
      config_path: loaded.configPath,
      spec_dir: loaded.specDirAbs,
      charter_dir: loaded.charterDirAbs,
      capability_count: capabilities.length,
      charter_count: charterCount,
      verify_configured: Boolean(loaded.config.verify),
    };
  } catch (e) {
    return {
      status: "invalid",
      project_root: projectRoot,
      relative_path: relativePath,
      config_path: resolve(projectRoot, "harness.yaml"),
      spec_dir: null,
      charter_dir: null,
      capability_count: null,
      charter_count: null,
      verify_configured: null,
      error: (e as Error).message,
    };
  }
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

function shouldSkipDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith(".");
}
