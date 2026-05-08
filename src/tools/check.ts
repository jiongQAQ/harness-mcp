/**
 * check - execute governance constraints.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadCapabilityMap, normalizeMapRelPath } from "../capability_map.ts";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import {
  analyzeBuiltinConstraintSteps,
  renderBuiltinConstraintRun,
  runBuiltinConstraints,
  SUPPORTED_CONSTRAINT_STEP_EXAMPLES,
} from "../constraint_runner.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell } from "../runner.ts";
import { parseReport, type ParsedReport } from "../parsers/report.ts";
import { checkFeatureQuality } from "../feature_quality.ts";

export const CheckInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  dryRun: z.boolean().optional().default(false).describe("只列出约束和命令,不实际运行"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type CheckInput = z.input<typeof CheckInputSchema>;

export interface ConstraintSpec {
  title: string;
  fileAbs: string;
  fileRel: string;
  content: string;
  scenarioCount: number;
  lastModified: string;
}

interface StaticCheck {
  id: string;
  level: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
}

const TITLE_RE = /^\s*(?:Feature|功能|機能|Característica):\s*(.+)$/m;
const SCENARIO_RE = /^\s*(?:Scenario|场景|場景|Escenario):\s*.+$/gm;

export async function executeCheck(input: CheckInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return formatMissingHarnessConfig(root);

  const staticChecks = await collectStaticChecks(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const staticStatus = summarizeStaticStatus(staticChecks);
  const constraints = await discoverConstraints(
    loaded.projectRoot,
    loaded.specDirAbs,
  );
  const command = loaded.config.commands?.check;
  const discoveryWarnings = getConstraintDiscoveryWarnings(
    loaded.projectRoot,
    loaded.config.spec_dir,
    loaded.specDirAbs,
  );
  const unsupportedSteps = command ? [] : analyzeBuiltinConstraintSteps(constraints);

  if (input.dryRun) {
    const payload = {
      command_type: "check",
      dry_run: true,
      status: staticStatus,
      project_root: loaded.projectRoot,
      static_checks: staticChecks,
      constraint_count: constraints.length,
      constraints: constraints.map((constraint) => ({
        title: constraint.title,
        file: constraint.fileRel,
        scenario_count: constraint.scenarioCount,
        last_modified: constraint.lastModified,
      })),
      cmd: command?.cmd ?? null,
      runner: command ? "command" : "builtin",
      workdir: command ? resolve(loaded.projectRoot, command.workdir ?? ".") : null,
      exit_code: null,
      report: null,
      report_path: command?.report
        ? resolve(loaded.projectRoot, command.workdir ?? ".", command.report.path)
        : null,
      discovery_warnings: discoveryWarnings,
      supported_step_examples: SUPPORTED_CONSTRAINT_STEP_EXAMPLES,
      unsupported_steps: unsupportedSteps,
    };

    return input.raw ? JSON.stringify(payload, null, 2) : renderDryRun(payload);
  }

  if (!command) {
    const run = await runBuiltinConstraints(loaded.projectRoot, constraints);
    const status = staticStatus === "fail" || run.report.summary.failed > 0 ? "fail" : staticStatus;
    if (input.raw) {
      return JSON.stringify(
        {
          command_type: "check",
          runner: "builtin",
          status,
          static_checks: staticChecks,
          constraint_count: constraints.length,
          exit_code: run.report.summary.failed > 0 ? 1 : 0,
          timed_out: false,
          duration_ms: run.durationMs,
          report: run.report,
          results: run.results,
        },
        null,
        2,
      );
    }
    return [renderStaticChecks(staticChecks), renderBuiltinConstraintRun(run)].join("\n\n");
  }

  const workdir = resolve(loaded.projectRoot, command.workdir ?? ".");
  const runResult = await runShell(command.cmd, {
    cwd: workdir,
    timeoutMs: command.timeout_ms,
  });

  let parsed: ParsedReport | null = null;
  let reportPathAbs: string | null = null;
  if (command.report) {
    reportPathAbs = resolve(workdir, command.report.path);
    parsed = await parseReport(command.report.format, reportPathAbs);
  }

  const commandFailed = runResult.exitCode !== 0 || runResult.timedOut || Boolean(parsed && parsed.summary.failed > 0);
  if (input.raw) {
    return JSON.stringify(
      {
        command_type: "check",
        runner: "command",
        status: staticStatus === "fail" || commandFailed ? "fail" : staticStatus,
        static_checks: staticChecks,
        constraint_count: constraints.length,
        cmd: command.cmd,
        workdir,
        exit_code: runResult.exitCode,
        timed_out: runResult.timedOut,
        duration_ms: runResult.durationMs,
        report: parsed,
        report_path: reportPathAbs,
        stdout_tail: runResult.stdout.slice(-2000),
        stderr_tail: runResult.stderr.slice(-2000),
      },
      null,
      2,
    );
  }

  return renderCheckRun({
    staticChecks,
    cmd: command.cmd,
    workdir,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    durationMs: runResult.durationMs,
    parsed,
    reportPathAbs,
    stderr: runResult.stderr,
  });
}

async function collectStaticChecks(
  projectRoot: string,
  specDirAbs: string,
  charterDirAbs: string,
): Promise<StaticCheck[]> {
  const checks: StaticCheck[] = [];
  const features = await collectBusinessFeatureFiles(projectRoot, specDirAbs);
  const qualityIssues = features.flatMap((feature) =>
    checkFeatureQuality(feature.content, feature.fileRel).issues.map((issue) => ({
      ...issue,
      fileRel: feature.fileRel,
    })),
  );

  const qualityIds = [...new Set([
    "feature_quality.language",
    "feature_quality.entrypoint",
    "feature_quality.required_sections",
    "feature_quality.business_source",
    "feature_quality.scenarios",
    "feature_quality.rules",
    "feature_quality.then_specificity",
    ...qualityIssues.map((issue) => issue.id),
  ])].sort();

  for (const id of qualityIds) {
    const issues = qualityIssues.filter((issue) => issue.id === id);
    const level = issues.some((issue) => issue.level === "fail")
      ? "fail"
      : issues.length > 0
        ? "warn"
        : "pass";
    checks.push({
      id,
      level,
      message: issues.length === 0 ? `${id} passed` : `${issues.length} ${id} issue(s) found`,
      detail: issues.map((issue) => `${issue.fileRel}: ${issue.message}`).join("; ") || undefined,
    });
  }

  checks.push(...await collectFeatureLayoutChecks(projectRoot, specDirAbs));
  checks.push(...await collectCharterFormatChecks(projectRoot, charterDirAbs));
  checks.push(...await collectMapAlignmentChecks(projectRoot, specDirAbs, features));
  checks.push(...await collectHarnessBddImplementationChecks(projectRoot, specDirAbs));
  return checks;
}

async function collectBusinessFeatureFiles(
  projectRoot: string,
  specDirAbs: string,
): Promise<{ fileRel: string; specRel: string; content: string }[]> {
  const featuresDir = resolve(specDirAbs, "features");
  if (!existsSync(featuresDir)) return [];
  const glob = new Glob("**/*.feature");
  const result: { fileRel: string; specRel: string; content: string }[] = [];
  for await (const rel of glob.scan({ cwd: featuresDir, onlyFiles: true })) {
    const abs = resolve(featuresDir, rel);
    result.push({
      fileRel: relative(projectRoot, abs),
      specRel: `features/${rel}`.replace(/\\/g, "/"),
      content: await readFile(abs, "utf-8"),
    });
  }
  return result;
}

async function collectFeatureLayoutChecks(
  projectRoot: string,
  specDirAbs: string,
): Promise<StaticCheck[]> {
  if (!existsSync(specDirAbs)) return [];
  const glob = new Glob("**/*.feature");
  const issues: string[] = [];
  for await (const rel of glob.scan({ cwd: specDirAbs, onlyFiles: true })) {
    const normalized = rel.replace(/\\/g, "/");
    const [top] = normalized.split("/");
    if (!top || top === "features" || top === "flows" || top === "constraints" || top.startsWith("_")) {
      continue;
    }
    issues.push(relative(projectRoot, resolve(specDirAbs, rel)));
  }

  return [{
    id: "feature_layout.business_features_under_features",
    level: issues.length === 0 ? "pass" : "fail",
    message: issues.length === 0 ? "business feature layout passed" : `${issues.length} feature file(s) found outside features/flows/constraints/_charter`,
    detail: issues.join("; ") || undefined,
  }];
}

async function collectCharterFormatChecks(
  projectRoot: string,
  charterDirAbs: string,
): Promise<StaticCheck[]> {
  if (!existsSync(charterDirAbs)) {
    return [{
      id: "charter_format.markdown",
      level: "pass",
      message: "charter markdown layout passed",
    }];
  }

  const glob = new Glob("**/*.feature");
  const issues: string[] = [];
  for await (const rel of glob.scan({ cwd: charterDirAbs, onlyFiles: true })) {
    issues.push(relative(projectRoot, resolve(charterDirAbs, rel)));
  }

  return [{
    id: "charter_format.markdown",
    level: issues.length === 0 ? "pass" : "fail",
    message: issues.length === 0
      ? "charter markdown layout passed"
      : `${issues.length} charter file(s) must be Markdown, not .feature`,
    detail: issues.join("; ") || undefined,
  }];
}

async function collectMapAlignmentChecks(
  projectRoot: string,
  specDirAbs: string,
  features: { fileRel: string; specRel: string; content: string }[],
): Promise<StaticCheck[]> {
  const map = await loadCapabilityMap(specDirAbs);
  if (!map.exists) {
    return [{ id: "capability_map.exists", level: "warn", message: "capability-map.yaml is missing" }];
  }
  if (!map.ok) {
    return [{ id: "capability_map.valid", level: "fail", message: "capability-map.yaml is invalid", detail: map.error }];
  }

  const issues: string[] = [];
  const featureBySpecRel = new Set(features.map((feature) => normalizeMapRelPath(feature.specRel)));
  for (const entry of map.capabilities) {
    if (!featureBySpecRel.has(normalizeMapRelPath(entry.file))) {
      issues.push(`${entry.id}: map file 不存在 ${entry.file}`);
    }
  }
  for (const feature of features) {
    const capability = feature.content.match(/^#\s*capability:\s*(.+)\s*$/m)?.[1]?.trim();
    if (!capability) {
      issues.push(`${feature.fileRel}: 缺少 # capability`);
      continue;
    }
    const entry = map.capabilities.find((item) => item.id === capability);
    if (!entry) {
      issues.push(`${feature.fileRel}: 未在 capability-map.yaml 中声明`);
    } else if (normalizeMapRelPath(entry.file) !== normalizeMapRelPath(feature.specRel)) {
      issues.push(`${feature.fileRel}: map file=${entry.file}, actual=${feature.specRel}`);
    }
  }

  const flowDir = resolve(specDirAbs, "flows");
  for (const flow of map.flows) {
    if (!existsSync(resolve(specDirAbs, flow.file))) {
      issues.push(`${flow.id}: flow file 不存在 ${flow.file}`);
    }
  }
  if (existsSync(flowDir)) {
    const glob = new Glob("**/*.feature");
    const mapFlowFiles = new Set(map.flows.map((flow) => normalizeMapRelPath(flow.file)));
    for await (const rel of glob.scan({ cwd: flowDir, onlyFiles: true })) {
      const specRel = `flows/${rel}`.replace(/\\/g, "/");
      if (!mapFlowFiles.has(normalizeMapRelPath(specRel))) {
        issues.push(`${relative(projectRoot, resolve(flowDir, rel))}: flow 未在 capability-map.yaml 中声明`);
      }
    }
  }

  return [{
    id: "capability_map.alignment",
    level: issues.length === 0 ? "pass" : "fail",
    message: issues.length === 0 ? "capability map aligns with features and flows" : `${issues.length} capability map alignment issue(s) found`,
    detail: issues.join("; ") || undefined,
  }];
}

async function collectHarnessBddImplementationChecks(
  projectRoot: string,
  specDirAbs: string,
): Promise<StaticCheck[]> {
  if (!existsSync(specDirAbs)) return [];
  const glob = new Glob("**/*");
  const issues: string[] = [];
  for await (const rel of glob.scan({ cwd: specDirAbs, onlyFiles: true })) {
    const normalized = rel.replace(/\\/g, "/").toLowerCase();
    const parts = normalized.split("/");
    const fileName = parts.at(-1) ?? "";
    if (fileName.endsWith(".feature") || normalized === "capability-map.yaml") continue;
    if (
      parts[0] === "bdd" ||
      parts.includes("steps") ||
      parts.includes("step-definitions") ||
      ["cucumber.js", "cucumber.cjs", "cucumber.mjs", "behave.ini", "pytest.ini"].includes(fileName)
    ) {
      issues.push(relative(projectRoot, resolve(specDirAbs, rel)));
    }
  }
  return [{
    id: "harness_contract.no_bdd_implementation",
    level: issues.length === 0 ? "pass" : "fail",
    message: issues.length === 0 ? "harness contains contract files only" : `${issues.length} BDD implementation artifact(s) found under harness`,
    detail: issues.join("; ") || undefined,
  }];
}

function summarizeStaticStatus(checks: StaticCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((check) => check.level === "fail")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function discoverConstraints(
  projectRoot: string,
  specDirAbs: string,
): Promise<ConstraintSpec[]> {
  const constraintsDirAbs = resolve(specDirAbs, "constraints");
  if (!existsSync(constraintsDirAbs)) return [];

  const glob = new Glob("**/*.feature");
  const result: ConstraintSpec[] = [];
  for await (const rel of glob.scan({ cwd: constraintsDirAbs, onlyFiles: true })) {
    const abs = resolve(constraintsDirAbs, rel);
    const content = await readFile(abs, "utf-8");
    const st = await stat(abs);
    result.push({
      title: content.match(TITLE_RE)?.[1]?.trim() ?? rel.replace(/\.feature$/, ""),
      fileAbs: abs,
      fileRel: relative(projectRoot, abs),
      content,
      scenarioCount: [...content.matchAll(SCENARIO_RE)].length,
      lastModified: st.mtime.toISOString(),
    });
  }

  return result.sort((a, b) => a.fileRel.localeCompare(b.fileRel));
}

export function getConstraintDiscoveryWarnings(
  projectRoot: string,
  configuredSpecDir: string,
  specDirAbs: string,
): string[] {
  const warnings: string[] = [];
  const expectedDir = resolve(specDirAbs, "constraints");
  const conventionalDir = resolve(projectRoot, "harness/constraints");
  const expectedRel = relative(projectRoot, expectedDir) || "constraints";
  const conventionalRel = relative(projectRoot, conventionalDir) || "harness/constraints";

  if (configuredSpecDir !== "harness") {
    warnings.push(
      `推荐 harness.yaml 使用 spec_dir: harness。当前 spec_dir: ${configuredSpecDir}; check 只扫描 ${expectedRel},不要让 AI 自己发明 harness/specs 这类目录。`,
    );
  }

  if (configuredSpecDir !== "harness" && existsSync(conventionalDir)) {
    warnings.push(
      `发现 ${conventionalRel},但当前配置下 check 不会扫描它;请改为 spec_dir: harness,或把约束移动到 ${expectedRel}。`,
    );
  }

  return warnings;
}

function renderDryRun(payload: {
  project_root: string;
  static_checks?: StaticCheck[];
  constraint_count: number;
  constraints: { title: string; file: string; scenario_count: number }[];
  cmd: string | null;
  workdir: string | null;
  discovery_warnings?: string[];
  supported_step_examples?: readonly string[];
  unsupported_steps?: { featureFile: string; step: string }[];
}): string {
  const lines = [
    renderStaticChecks(payload.static_checks ?? []),
    "",
    `Constraints: ${payload.constraint_count}`,
    `project: ${payload.project_root}`,
    "",
  ];

  if (payload.constraints.length === 0) {
    lines.push("(none)");
  } else {
    for (const constraint of payload.constraints) {
      lines.push(`- ${constraint.title}`);
      lines.push(`    file: ${constraint.file}`);
      lines.push(`    scenarios: ${constraint.scenario_count}`);
    }
  }

  lines.push("");
  if (payload.cmd) {
    lines.push("$ " + payload.cmd);
    lines.push(`  cwd: ${payload.workdir}`);
  } else {
    lines.push("(commands.check not configured)");
  }

  if (payload.discovery_warnings?.length) {
    lines.push("");
    lines.push("Discovery warnings:");
    for (const warning of payload.discovery_warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (payload.unsupported_steps?.length) {
    lines.push("");
    lines.push("Unsupported constraint steps:");
    for (const issue of payload.unsupported_steps) {
      lines.push(`  - ${issue.featureFile}: ${issue.step}`);
    }
  }

  if (payload.supported_step_examples?.length) {
    lines.push("");
    lines.push("Supported built-in check steps:");
    for (const example of payload.supported_step_examples) {
      lines.push(`  - ${example}`);
    }
  }

  return lines.join("\n");
}

function renderCheckRun(args: {
  staticChecks: StaticCheck[];
  cmd: string;
  workdir: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  parsed: ParsedReport | null;
  reportPathAbs: string | null;
  stderr: string;
}): string {
  const out: string[] = [];
  out.push(renderStaticChecks(args.staticChecks));
  out.push("");
  out.push(`$ ${args.cmd}`);
  out.push(`  cwd: ${args.workdir}`);
  out.push(
    `  exit=${args.exitCode}${args.timedOut ? " (TIMED OUT)" : ""}, ${
      args.durationMs
    }ms`,
  );
  out.push("");

  if (args.parsed) {
    const s = args.parsed.summary;
    out.push(
      `── Test Summary ── total=${s.total} passed=${s.passed} failed=${s.failed} skipped=${s.skipped} pending=${s.pending}`,
    );
    if (args.parsed.failures.length > 0) {
      out.push("");
      out.push("── Failures ──");
      for (const f of args.parsed.failures) {
        out.push(`  ✗ ${f.feature} › ${f.scenario}`);
        if (f.featureFile) out.push(`      ${f.featureFile}${f.line ? `:${f.line}` : ""}`);
        if (f.failedStep) out.push(`      step: ${f.failedStep}`);
        if (f.errorMessage) out.push(`      error: ${f.errorMessage.split("\n")[0]}`);
      }
    }
  } else if (args.reportPathAbs) {
    out.push(`(report 文件未生成或解析失败: ${args.reportPathAbs})`);
  } else {
    out.push("(harness.yaml 未配置 report,跳过报告解析)");
  }

  if (args.stderr.trim()) {
    out.push("");
    out.push("── stderr (tail) ──");
    out.push(args.stderr.slice(-1000).trimEnd());
  }

  return out.join("\n");
}

function renderStaticChecks(checks: StaticCheck[]): string {
  const status = summarizeStaticStatus(checks);
  const lines = [`Static checks: ${status.toUpperCase()}`];
  for (const check of checks.filter((item) => item.level !== "pass")) {
    lines.push(`  ${check.level.toUpperCase()} ${check.id}: ${check.message}`);
    if (check.detail) lines.push(`    ${check.detail}`);
  }
  return lines.join("\n");
}
