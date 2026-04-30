/**
 * doctor — static diagnostics for harness-mcp project wiring.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";

export const DoctorInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type DoctorInput = z.infer<typeof DoctorInputSchema>;

type CheckLevel = "pass" | "warn" | "fail";

interface DoctorCheck {
  id: string;
  level: CheckLevel;
  message: string;
  detail?: string;
}

interface FeatureMeta {
  fileRel: string;
  name: string;
  hasExplicitCapability: boolean;
}

const SUPPORTED_REPORT_FORMATS = new Set(["cucumber-json"]);
const CAP_RE = /^#\s*capability:\s*(.+)\s*$/m;

export async function executeDoctor(input: DoctorInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const checks: DoctorCheck[] = [];

  const loaded = await tryLoadConfig(root, checks);
  if (!loaded) {
    return renderDoctor({ status: summarizeStatus(checks), project_root: root, checks }, input.raw);
  }

  checks.push({
    id: "config.exists",
    level: "pass",
    message: "harness.yaml found",
    detail: loaded.configPath,
  });
  checks.push({
    id: "config.valid",
    level: "pass",
    message: "harness.yaml is valid",
  });

  checks.push({
    id: "spec_dir.exists",
    level: existsSync(loaded.specDirAbs) ? "pass" : "fail",
    message: existsSync(loaded.specDirAbs)
      ? "spec_dir found"
      : "spec_dir is missing",
    detail: loaded.specDirAbs,
  });

  checks.push({
    id: "charter_dir.exists",
    level: existsSync(loaded.charterDirAbs) ? "pass" : "warn",
    message: existsSync(loaded.charterDirAbs)
      ? "charter_dir found"
      : "charter_dir is missing",
    detail: loaded.charterDirAbs,
  });

  const capabilities = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  checks.push({
    id: "capabilities.non_empty",
    level: capabilities.length > 0 ? "pass" : "warn",
    message:
      capabilities.length > 0
        ? `${capabilities.length} capabilities found`
        : "no capabilities found",
  });

  const featureMeta = await collectFeatureMeta(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const missingCapability = featureMeta.filter((f) => !f.hasExplicitCapability);
  checks.push({
    id: "capabilities.metadata",
    level: missingCapability.length === 0 ? "pass" : "fail",
    message:
      missingCapability.length === 0
        ? "all capabilities have # capability"
        : `${missingCapability.length} capability files are missing # capability`,
    detail:
      missingCapability.length === 0
        ? undefined
        : missingCapability.map((f) => f.fileRel).join(", "),
  });

  const duplicates = findDuplicates(featureMeta.map((f) => f.name));
  checks.push({
    id: "capabilities.unique",
    level: duplicates.length === 0 ? "pass" : "fail",
    message:
      duplicates.length === 0
        ? "capability names are unique"
        : "duplicate capability names found",
    detail: duplicates.length === 0 ? undefined : duplicates.join(", "),
  });

  const verifyCfg = loaded.config.verify;
  if (!verifyCfg) {
    checks.push({
      id: "verify.configured",
      level: "warn",
      message: "verify is not configured",
    });
  } else {
    checks.push({
      id: "verify.configured",
      level: "pass",
      message: "verify is configured",
      detail: verifyCfg.cmd,
    });

    if (!verifyCfg.report) {
      checks.push({
        id: "verify.report.format",
        level: "warn",
        message: "verify report is not configured",
      });
    } else {
      const supported = SUPPORTED_REPORT_FORMATS.has(verifyCfg.report.format);
      checks.push({
        id: "verify.report.format",
        level: supported ? "pass" : "fail",
        message: supported
          ? `${verifyCfg.report.format} report parser is supported`
          : `${verifyCfg.report.format} report parser is not implemented`,
      });

      const reportPath = resolve(
        loaded.projectRoot,
        verifyCfg.workdir ?? ".",
        verifyCfg.report.path,
      );
      checks.push({
        id: "verify.report.path_exists",
        level: existsSync(reportPath) ? "pass" : "warn",
        message: existsSync(reportPath)
          ? "verify report file exists"
          : "verify report file does not exist yet",
        detail: reportPath,
      });
    }
  }

  return renderDoctor(
    { status: summarizeStatus(checks), project_root: loaded.projectRoot, checks },
    input.raw,
  );
}

async function tryLoadConfig(root: string, checks: DoctorCheck[]) {
  try {
    const loaded = await loadConfig(root);
    if (!loaded) {
      checks.push({
        id: "config.exists",
        level: "fail",
        message: "harness.yaml is missing",
        detail: resolve(root, "harness.yaml"),
      });
      return null;
    }
    return loaded;
  } catch (e) {
    checks.push({
      id: "config.exists",
      level: "pass",
      message: "harness.yaml found",
      detail: resolve(root, "harness.yaml"),
    });
    checks.push({
      id: "config.valid",
      level: "fail",
      message: "harness.yaml is invalid",
      detail: (e as Error).message,
    });
    return null;
  }
}

async function collectFeatureMeta(
  projectRoot: string,
  specDirAbs: string,
  charterDirAbs: string,
): Promise<FeatureMeta[]> {
  if (!existsSync(specDirAbs)) return [];
  const glob = new Glob("**/*.feature");
  const result: FeatureMeta[] = [];

  for await (const rel of glob.scan({ cwd: specDirAbs, onlyFiles: true })) {
    const abs = resolve(specDirAbs, rel);
    if (abs.startsWith(charterDirAbs + "/")) continue;
    if (rel.split("/").some((seg) => seg.startsWith("_"))) continue;

    const content = await readFile(abs, "utf-8");
    const capMatch = content.match(CAP_RE);
    const fileRel = relative(projectRoot, abs);
    result.push({
      fileRel,
      name: capMatch?.[1]?.trim() ?? fileRel.replace(/\.feature$/, ""),
      hasExplicitCapability: Boolean(capMatch?.[1]?.trim()),
    });
  }

  return result;
}

function findDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function summarizeStatus(checks: DoctorCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.level === "fail")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

function renderDoctor(
  payload: { status: "pass" | "warn" | "fail"; project_root: string; checks: DoctorCheck[] },
  raw?: boolean,
): string {
  if (raw) return JSON.stringify(payload, null, 2);

  const lines: string[] = [`Doctor: ${payload.status}`, ""];
  for (const level of ["fail", "warn", "pass"] as const) {
    const checks = payload.checks.filter((c) => c.level === level);
    if (checks.length === 0) continue;
    lines.push(level.toUpperCase());
    for (const check of checks) {
      lines.push(`  ${check.id}: ${check.message}`);
      if (check.detail) lines.push(`    ${check.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
