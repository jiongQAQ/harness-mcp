/**
 * doctor — static diagnostics for harness-mcp project wiring.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import {
  loadCapabilityMap,
  normalizeMapRelPath,
  type CapabilityMapLoad,
} from "../capability_map.ts";
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
  specRel: string;
  name: string;
  content: string;
  hasExplicitCapability: boolean;
}

interface HarnessFeatureMeta {
  fileRel: string;
  content: string;
}

const CAP_RE = /^#\s*capability:\s*(.+)\s*$/m;
const FEATURE_TITLE_RE = /^\s*(?:Feature|功能|功能性|Característica|機能):\s*(.+)$/m;
const SCENARIO_RE = /^\s*(?:Scenario|场景|場景|Escenario):\s*.+$/gm;
const STEP_RE = /^\s*(?:Given|When|Then|And|But|假设|当|那么|而且|但是)\s+(.+)$/gm;
const SECTION_HEADING_RE = /^\s*(业务来源|意图|边界|核心承诺|风险|待确认)\s*[：:]\s*$/;
const FLOW_TITLE_RE = /(?:流程|全链路|端到端|E2E|workflow|journey)/i;
const ORDERED_STEP_RE = /(?:先|再|然后|最后|first|then|finally)/i;
const SCENARIO_COUNT_WARN_LIMIT = 7;
const CORE_PROMISE_WARN_LIMIT = 6;
const ORDERED_STEP_WARN_LIMIT = 2;
const BDD_STEP_DIR_SEGMENTS = new Set(["steps", "step-definitions", "step_definitions"]);
const BDD_RUNNER_CONFIG_FILES = new Set([
  "cucumber.js",
  "cucumber.cjs",
  "cucumber.mjs",
  "cucumber.ts",
  "behave.ini",
  "pytest.ini",
]);
const BDD_STEP_CODE_FILE_RE =
  /(?:^|[._-])(?:steps?|step[-_]?defs?)(?:[._-]|$).*\.(?:ts|tsx|js|jsx|mjs|cjs|java|kt|py|rb|go|cs)$/i;

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

  const capabilityMap = await loadCapabilityMap(loaded.specDirAbs);
  pushCapabilityMapChecks(
    checks,
    capabilityMap,
    loaded.projectRoot,
    loaded.specDirAbs,
    featureMeta,
  );

  const misplacedCapabilities = featureMeta.filter(
    (feature) => !isRecommendedCapabilitySpecRel(feature.specRel),
  );
  checks.push({
    id: "capabilities.layout",
    level: misplacedCapabilities.length === 0 ? "pass" : "warn",
    message:
      misplacedCapabilities.length === 0
        ? "capability features are under features/<业务域>"
        : `${misplacedCapabilities.length} capability feature files are outside features/<业务域>`,
    detail:
      misplacedCapabilities.length === 0
        ? undefined
        : misplacedCapabilities
            .map(
              (feature) =>
                `${feature.fileRel} -> ${recommendedCapabilityFileRel(
                  loaded.projectRoot,
                  loaded.specDirAbs,
                  feature.specRel,
                )}`,
            )
            .join("; "),
  });

  const boundaryFindings = featureMeta
    .map((feature) => ({
      fileRel: feature.fileRel,
      reasons: analyzeCapabilityBoundary(feature.content),
    }))
    .filter((finding) => finding.reasons.length > 0);
  checks.push({
    id: "capabilities.boundary",
    level: boundaryFindings.length === 0 ? "pass" : "warn",
    message:
      boundaryFindings.length === 0
        ? "capability boundaries look focused"
        : `${boundaryFindings.length} capability feature files may be too broad`,
    detail:
      boundaryFindings.length === 0
        ? undefined
        : boundaryFindings
            .map((finding) => `${finding.fileRel}: ${finding.reasons.join(", ")}`)
            .join("; "),
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

  const bddImplementationArtifacts = await collectHarnessBddImplementationArtifacts(
    loaded.projectRoot,
    loaded.specDirAbs,
  );
  checks.push({
    id: "harness_contract.no_bdd_implementation",
    level: bddImplementationArtifacts.length === 0 ? "pass" : "fail",
    message:
      bddImplementationArtifacts.length === 0
        ? "harness contains contract files only; BDD implementation lives in host tests"
        : `${bddImplementationArtifacts.length} BDD implementation artifacts found under harness`,
    detail:
      bddImplementationArtifacts.length === 0
        ? undefined
        : bddImplementationArtifacts
            .map((artifact) => `${artifact.fileRel}: ${artifact.reason}`)
            .join("; "),
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
      specRel: rel,
      name: capMatch?.[1]?.trim() ?? fileRel.replace(/\.feature$/, ""),
      content,
      hasExplicitCapability: Boolean(capMatch?.[1]?.trim()),
    });
  }

  return result;
}

function isRecommendedCapabilitySpecRel(specRel: string): boolean {
  const segments = specRel.split(/[\\/]+/).filter(Boolean);
  return segments[0] === "features" && segments.length >= 3;
}

function recommendedCapabilityFileRel(
  projectRoot: string,
  specDirAbs: string,
  specRel: string,
): string {
  const segments = specRel.split(/[\\/]+/).filter(Boolean);
  const fileName = segments.at(-1) ?? "capability.feature";
  if (segments[0] === "features") {
    return relative(projectRoot, resolve(specDirAbs, "features", "<业务域>", fileName));
  }
  if (segments.length < 2) {
    return relative(projectRoot, resolve(specDirAbs, "features", "<业务域>", fileName));
  }
  return relative(projectRoot, resolve(specDirAbs, "features", specRel));
}

function pushCapabilityMapChecks(
  checks: DoctorCheck[],
  capabilityMap: CapabilityMapLoad,
  projectRoot: string,
  specDirAbs: string,
  featureMeta: FeatureMeta[],
): void {
  if (!capabilityMap.exists) {
    checks.push({
      id: "capability_map.exists",
      level: "warn",
      message: "capability-map.yaml is missing",
      detail: relative(projectRoot, capabilityMap.path),
    });
    return;
  }

  checks.push({
    id: "capability_map.exists",
    level: "pass",
    message: "capability-map.yaml found",
    detail: relative(projectRoot, capabilityMap.path),
  });

  if (!capabilityMap.ok) {
    checks.push({
      id: "capability_map.valid",
      level: "fail",
      message: "capability-map.yaml is invalid",
      detail: capabilityMap.error,
    });
    return;
  }

  checks.push({
    id: "capability_map.valid",
    level: "pass",
    message: "capability-map.yaml is valid",
  });

  const mapById = new Map(capabilityMap.capabilities.map((entry) => [entry.id, entry]));
  const featureByName = new Map(featureMeta.map((feature) => [feature.name, feature]));
  const featureBySpecRel = new Map(
    featureMeta.map((feature) => [normalizeMapRelPath(feature.specRel), feature]),
  );
  const capabilityErrors: string[] = [];
  const capabilityWarnings: string[] = [];

  for (const feature of featureMeta) {
    const mapEntry = mapById.get(feature.name);
    if (!mapEntry) {
      capabilityErrors.push(`${feature.fileRel}: 未在 capability-map.yaml 中声明`);
      continue;
    }
    if (normalizeMapRelPath(mapEntry.file) !== normalizeMapRelPath(feature.specRel)) {
      capabilityErrors.push(
        `${feature.fileRel}: map file=${mapEntry.file}, actual=${feature.specRel}`,
      );
    }
  }

  for (const mapEntry of capabilityMap.capabilities) {
    const expectedAbs = resolve(specDirAbs, mapEntry.file);
    if (!existsSync(expectedAbs)) {
      capabilityWarnings.push(`${mapEntry.id}: map file 不存在 ${mapEntry.file}`);
    }
    const featureAtMapPath = featureBySpecRel.get(normalizeMapRelPath(mapEntry.file));
    if (featureAtMapPath && featureAtMapPath.name !== mapEntry.id) {
      capabilityErrors.push(
        `${mapEntry.id}: map file ${mapEntry.file} 内的 # capability 是 ${featureAtMapPath.name}`,
      );
    }
    const feature = featureByName.get(mapEntry.id);
    if (feature && normalizeMapRelPath(feature.specRel) !== normalizeMapRelPath(mapEntry.file)) {
      capabilityErrors.push(`${mapEntry.id}: feature path 与 map file 不一致`);
    }
  }

  const capabilityIssues = [...capabilityErrors, ...capabilityWarnings];
  checks.push({
    id: "capability_map.capabilities",
    level:
      capabilityErrors.length > 0
        ? "fail"
        : capabilityWarnings.length > 0
          ? "warn"
          : "pass",
    message:
      capabilityIssues.length === 0
        ? "capability map matches capability feature files"
        : `${capabilityIssues.length} capability map alignment issues found`,
    detail: capabilityIssues.length === 0 ? undefined : capabilityIssues.join("; "),
  });

  const flowIssues = capabilityMap.flows
    .filter((flow) => !existsSync(resolve(specDirAbs, flow.file)))
    .map((flow) => `${flow.id}: map flow file 不存在 ${flow.file}`);
  checks.push({
    id: "capability_map.flows",
    level: flowIssues.length === 0 ? "pass" : "warn",
    message:
      flowIssues.length === 0
        ? "capability map flow files are present"
        : `${flowIssues.length} capability map flow files are missing`,
    detail: flowIssues.length === 0 ? undefined : flowIssues.join("; "),
  });
}

function analyzeCapabilityBoundary(content: string): string[] {
  const reasons: string[] = [];
  const title = content.match(FEATURE_TITLE_RE)?.[1]?.trim() ?? "";
  if (title && FLOW_TITLE_RE.test(title)) {
    reasons.push("flow_like_title");
  }

  const scenarioCount = [...content.matchAll(SCENARIO_RE)].length;
  if (scenarioCount > SCENARIO_COUNT_WARN_LIMIT) {
    reasons.push(`scenario_count=${scenarioCount}>${SCENARIO_COUNT_WARN_LIMIT}`);
  }

  const corePromises = countSectionItems(content, "核心承诺");
  if (corePromises > CORE_PROMISE_WARN_LIMIT) {
    reasons.push(`core_promises=${corePromises}>${CORE_PROMISE_WARN_LIMIT}`);
  }

  const orderedSteps = [...content.matchAll(STEP_RE)].filter((match) =>
    ORDERED_STEP_RE.test(match[1] ?? ""),
  ).length;
  if (orderedSteps > ORDERED_STEP_WARN_LIMIT) {
    reasons.push(`ordered_steps=${orderedSteps}>${ORDERED_STEP_WARN_LIMIT}`);
  }

  return reasons;
}

function countSectionItems(content: string, sectionName: string): number {
  let inSection = false;
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(SECTION_HEADING_RE)?.[1] ?? null;
    if (heading) {
      inSection = heading === sectionName;
      continue;
    }
    if (!inSection) continue;
    if (/^\s*(?:Scenario|场景|場景|Escenario|Feature|功能|機能|Característica):/.test(line)) {
      break;
    }
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) count += 1;
  }
  return count;
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

async function collectHarnessBddImplementationArtifacts(
  projectRoot: string,
  specDirAbs: string,
): Promise<{ fileRel: string; reason: string }[]> {
  if (!existsSync(specDirAbs)) return [];

  const glob = new Glob("**/*");
  const result: { fileRel: string; reason: string }[] = [];
  for await (const rel of glob.scan({ cwd: specDirAbs, onlyFiles: true })) {
    const reason = classifyHarnessBddImplementationArtifact(rel);
    if (!reason) continue;
    result.push({
      fileRel: relative(projectRoot, resolve(specDirAbs, rel)),
      reason,
    });
  }
  return result.sort((a, b) => a.fileRel.localeCompare(b.fileRel));
}

function classifyHarnessBddImplementationArtifact(specRel: string): string | null {
  const normalized = specRel.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const fileName = lowerSegments.at(-1) ?? "";

  if (normalized === "capability-map.yaml") {
    return null;
  }
  if (lowerSegments[0] === "bdd") {
    return "BDD runner config, reports, and step definitions must live in host project tests, not harness/bdd";
  }
  if (fileName.endsWith(".feature")) {
    return null;
  }
  if (lowerSegments.some((segment) => BDD_STEP_DIR_SEGMENTS.has(segment))) {
    return "BDD step definitions must live in host project tests, not harness";
  }
  if (BDD_RUNNER_CONFIG_FILES.has(fileName)) {
    return "BDD runner config must live with host project tests, not harness";
  }
  if (BDD_STEP_CODE_FILE_RE.test(fileName)) {
    return "BDD step definition code must live in host project tests, not harness";
  }

  return null;
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
