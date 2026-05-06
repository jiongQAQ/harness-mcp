/**
 * doctor — static diagnostics for harness-mcp project wiring.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, isReservedSpecFeatureRel } from "../capability.ts";
import { analyzeBuiltinConstraintSteps } from "../constraint_runner.ts";
import {
  checkFeatureQuality,
  hasZhCnLanguageHeader,
} from "../feature_quality.ts";
import { SUPPORTED_REPORT_FORMATS } from "../parsers/report.ts";
import { resolveProjectRoot } from "../project.ts";
import {
  discoverConstraints,
  getConstraintDiscoveryWarnings,
} from "./check.ts";

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
  content: string;
  hasExplicitCapability: boolean;
}

interface HarnessFeatureMeta {
  fileRel: string;
  content: string;
}

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
    id: "config.spec_dir_convention",
    level: loaded.config.spec_dir === "harness" ? "pass" : "warn",
    message:
      loaded.config.spec_dir === "harness"
        ? "spec_dir follows harness convention"
        : `推荐 harness.yaml 使用 spec_dir: harness,不要让 AI 自己发明 ${loaded.config.spec_dir} 这类目录`,
    detail: loaded.config.spec_dir,
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

  const qualityIssues = featureMeta.flatMap((feature) =>
    checkFeatureQuality(feature.content, feature.fileRel).issues.map((issue) => ({
      ...issue,
      fileRel: feature.fileRel,
    })),
  );
  for (const id of [
    "feature_quality.language",
    "feature_quality.required_sections",
    "feature_quality.business_source",
    "feature_quality.scenarios",
    "feature_quality.path_style",
  ]) {
    const issues = qualityIssues.filter((issue) => issue.id === id);
    if (issues.length === 0) {
      checks.push({
        id,
        level: "pass",
        message: featureQualityPassMessage(id),
      });
      continue;
    }
    const level = issues.some((issue) => issue.level === "fail") ? "fail" : "warn";
    checks.push({
      id,
      level,
      message: featureQualityIssueMessage(id, issues.length),
      detail: issues.map((issue) => `${issue.fileRel}: ${issue.message}`).join("; "),
    });
  }

  const nonBusinessFeatures = await collectNonBusinessFeatureMeta(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const missingNonBusinessLanguage = nonBusinessFeatures.filter(
    (feature) => !hasZhCnLanguageHeader(feature.content),
  );
  checks.push({
    id: "harness_language.non_business_zh_cn",
    level: missingNonBusinessLanguage.length === 0 ? "pass" : "warn",
    message:
      missingNonBusinessLanguage.length === 0
        ? "charter/constraints/flows use # language: zh-CN"
        : `${missingNonBusinessLanguage.length} non-business harness files are missing # language: zh-CN`,
    detail:
      missingNonBusinessLanguage.length === 0
        ? undefined
        : missingNonBusinessLanguage.map((feature) => feature.fileRel).join(", "),
  });

  const constraints = await discoverConstraints(
    loaded.projectRoot,
    loaded.specDirAbs,
  );
  const constraintDiscoveryWarnings = getConstraintDiscoveryWarnings(
    loaded.projectRoot,
    loaded.config.spec_dir,
    loaded.specDirAbs,
  );
  checks.push({
    id: "constraints.discoverable",
    level:
      constraintDiscoveryWarnings.length > 0
        ? "fail"
        : constraints.length > 0
          ? "pass"
          : "warn",
    message:
      constraintDiscoveryWarnings.length > 0
        ? "constraints are outside the directory check scans"
        : constraints.length > 0
          ? `${constraints.length} constraints found`
          : "no constraints found",
    detail:
      constraintDiscoveryWarnings.length === 0
        ? undefined
        : constraintDiscoveryWarnings.join("; "),
  });

  const unsupportedConstraintSteps = loaded.config.commands?.check
    ? []
    : analyzeBuiltinConstraintSteps(constraints);
  checks.push({
    id: "constraints.builtin_steps",
    level: unsupportedConstraintSteps.length === 0 ? "pass" : "fail",
    message:
      unsupportedConstraintSteps.length === 0
        ? loaded.config.commands?.check
          ? "commands.check is configured; built-in step DSL is optional"
          : "all built-in constraint steps are supported"
        : `${unsupportedConstraintSteps.length} unsupported built-in constraint steps found`,
    detail:
      unsupportedConstraintSteps.length === 0
        ? undefined
        : unsupportedConstraintSteps
            .map((issue) => `${issue.featureFile}: ${issue.step}`)
            .join("; "),
  });

  const bddCfg = loaded.config.bdd;
  const detectedRunners = await detectBddRunners(loaded.projectRoot);
  if (!bddCfg) {
    checks.push({
      id: "bdd.configured",
      level: "warn",
      message: "bdd is not configured; verify/flow cannot execute .feature files",
      detail:
        detectedRunners.length > 0
          ? `detected possible runner(s): ${detectedRunners.join(", ")}`
          : "configure bdd.runner and bdd.cmd in harness.yaml",
    });
  } else {
    const runnerMatches =
      detectedRunners.length === 0 ||
      bddCfg.runner === "custom" ||
      detectedRunners.includes(bddCfg.runner);
    checks.push({
      id: "bdd.configured",
      level: "pass",
      message: `bdd is configured (${bddCfg.runner})`,
      detail: bddCfg.cmd,
    });

    checks.push({
      id: "bdd.runner.detected",
      level: runnerMatches ? "pass" : "warn",
      message:
        detectedRunners.length === 0
          ? "no host BDD runner manifest detected"
          : `detected possible runner(s): ${detectedRunners.join(", ")}`,
      detail:
        detectedRunners.length > 0 && !runnerMatches
          ? `configured runner: ${bddCfg.runner}`
          : undefined,
    });

    const supported = SUPPORTED_REPORT_FORMATS.has(bddCfg.report.format);
    checks.push({
      id: "bdd.report.format",
      level: supported ? "pass" : "fail",
      message: supported
        ? `${bddCfg.report.format} report parser is supported`
        : `${bddCfg.report.format} report parser is not implemented`,
    });

    const reportPath = resolve(
      loaded.projectRoot,
      bddCfg.workdir ?? ".",
      bddCfg.report.path,
    );
    checks.push({
      id: "bdd.report.path_exists",
      level: existsSync(reportPath) ? "pass" : "warn",
      message: existsSync(reportPath)
        ? "bdd report file exists"
        : "bdd report file does not exist yet",
      detail: reportPath,
    });
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
    if (isReservedSpecFeatureRel(rel)) continue;

    const content = await readFile(abs, "utf-8");
    const capMatch = content.match(CAP_RE);
    const fileRel = relative(projectRoot, abs);
    result.push({
      fileRel,
      name: capMatch?.[1]?.trim() ?? fileRel.replace(/\.feature$/, ""),
      content,
      hasExplicitCapability: Boolean(capMatch?.[1]?.trim()),
    });
  }

  return result;
}

async function collectNonBusinessFeatureMeta(
  projectRoot: string,
  specDirAbs: string,
  charterDirAbs: string,
): Promise<HarnessFeatureMeta[]> {
  const result: HarnessFeatureMeta[] = [];
  const seen = new Set<string>();
  await collectFeatureFilesUnder(charterDirAbs, projectRoot, result, seen);
  await collectFeatureFilesUnder(resolve(specDirAbs, "constraints"), projectRoot, result, seen);
  await collectFeatureFilesUnder(resolve(specDirAbs, "flows"), projectRoot, result, seen);
  return result;
}

async function collectFeatureFilesUnder(
  dirAbs: string,
  projectRoot: string,
  result: HarnessFeatureMeta[],
  seen: Set<string>,
): Promise<void> {
  if (!existsSync(dirAbs)) return;
  const glob = new Glob("**/*.feature");
  for await (const rel of glob.scan({ cwd: dirAbs, onlyFiles: true })) {
    const abs = resolve(dirAbs, rel);
    if (seen.has(abs)) continue;
    seen.add(abs);
    result.push({
      fileRel: relative(projectRoot, abs),
      content: await readFile(abs, "utf-8"),
    });
  }
}

function featureQualityPassMessage(id: string): string {
  switch (id) {
    case "feature_quality.language":
      return "all capability features use # language: zh-CN";
    case "feature_quality.required_sections":
      return "all capability features have required business contract sections";
    case "feature_quality.business_source":
      return "all capability features declare business source type";
    case "feature_quality.scenarios":
      return "all capability features have at least one scenario";
    case "feature_quality.path_style":
      return "feature paths look business-oriented";
    default:
      return `${id} passed`;
  }
}

function featureQualityIssueMessage(id: string, count: number): string {
  switch (id) {
    case "feature_quality.language":
      return `${count} capability features are missing # language: zh-CN`;
    case "feature_quality.required_sections":
      return `${count} feature quality section issues found`;
    case "feature_quality.business_source":
      return `${count} feature business source issues found`;
    case "feature_quality.scenarios":
      return `${count} feature scenario issues found`;
    case "feature_quality.path_style":
      return `${count} feature paths look code-module oriented`;
    default:
      return `${count} ${id} issues found`;
  }
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

async function detectBddRunners(projectRoot: string): Promise<string[]> {
  const detected = new Set<string>();

  const packageJson = await readOptional(resolve(projectRoot, "package.json"));
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (deps["@cucumber/cucumber"]) detected.add("cucumber-js");
    } catch {
      // ignore malformed host package.json here; config validation is separate
    }
  }

  const pomXml = await readOptional(resolve(projectRoot, "pom.xml"));
  if (pomXml && /io\.cucumber|cucumber-java|cucumber-junit/i.test(pomXml)) {
    detected.add("cucumber-jvm");
  }

  const pythonConfigs = (
    await Promise.all([
      readOptional(resolve(projectRoot, "pyproject.toml")),
      readOptional(resolve(projectRoot, "pytest.ini")),
      readOptional(resolve(projectRoot, "setup.cfg")),
    ])
  ).join("\n");
  if (/\bbehave\b/i.test(pythonConfigs)) detected.add("behave");
  if (/pytest-bdd/i.test(pythonConfigs)) detected.add("pytest-bdd");

  const goMod = await readOptional(resolve(projectRoot, "go.mod"));
  if (goMod && /github\.com\/cucumber\/godog/i.test(goMod)) {
    detected.add("godog");
  }

  return [...detected].sort();
}

async function readOptional(path: string): Promise<string> {
  if (!existsSync(path)) return "";
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
