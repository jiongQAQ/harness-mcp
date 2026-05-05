/**
 * Built-in generic constraint runner.
 *
 * This intentionally covers the small lint-step vocabulary that makes
 * constraints useful without requiring every project to wire a test runner.
 */
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { runShell, type RunResult } from "./runner.ts";

export interface BuiltinConstraintSource {
  title: string;
  fileAbs: string;
  fileRel: string;
  content: string;
}

export interface ConstraintSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface ConstraintFailure {
  feature: string;
  scenario: string;
  featureFile: string;
  line?: number;
  failedStep?: string;
  errorMessage: string;
}

export interface ConstraintScenarioResult {
  feature: string;
  scenario: string;
  featureFile: string;
  line?: number;
  status: "passed" | "failed" | "skipped" | "pending";
  failedStep?: string;
  errorMessage?: string;
}

export interface BuiltinConstraintReport {
  summary: ConstraintSummary;
  failures: ConstraintFailure[];
}

export interface BuiltinConstraintRun {
  durationMs: number;
  report: BuiltinConstraintReport;
  results: ConstraintScenarioResult[];
}

export interface UnsupportedConstraintStepIssue {
  feature: string;
  scenario: string;
  featureFile: string;
  line?: number;
  step: string;
  stepLine?: number;
}

export const SUPPORTED_CONSTRAINT_STEP_EXAMPLES = [
  '假设 扫描本次新增的 "server/**/*.ts" 行',
  '假设 扫描 "server/**/*.ts"',
  '假设 扫描当前包的 "ts" 文件',
  '当 匹配到 "console\\\\.log"',
  '那么 应该报错 "本次修改新增了调试输出"',
  '而且 修正方式为 "删除调试输出；确需日志时使用项目统一 logger"',
  "那么 不应该有匹配",
  "那么 应该存在",
  "那么 不应该存在",
  '当 运行命令 "npm test"',
  "那么 命令应该成功",
] as const;

interface ParsedScenario {
  feature: string;
  scenario: string;
  line?: number;
  steps: ParsedStep[];
}

interface ParsedStep {
  text: string;
  line?: number;
}

interface LintMatch {
  file: string;
  line: number;
  content: string;
}

interface LintWorld {
  cwd: string;
  files: string[];
  lineCandidates: LintMatch[] | null;
  matches: LintMatch[];
  message: string;
  fix: string;
  execResult: RunResult | null;
}

class StepFailure extends Error {
  constructor(
    message: string,
    readonly failedStep?: string,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

export async function runBuiltinConstraints(
  projectRoot: string,
  constraints: BuiltinConstraintSource[],
): Promise<BuiltinConstraintRun> {
  const started = Date.now();
  const results: ConstraintScenarioResult[] = [];

  for (const constraint of constraints) {
    const scenarios = parseConstraintScenarios(constraint);
    for (const scenario of scenarios) {
      results.push(await runScenario(projectRoot, constraint.fileRel, scenario));
    }
  }

  const summary = summarize(results);
  const failures = results
    .filter((result): result is ConstraintScenarioResult & { errorMessage: string } =>
      result.status === "failed" && Boolean(result.errorMessage),
    )
    .map((result) => ({
      feature: result.feature,
      scenario: result.scenario,
      featureFile: result.featureFile,
      line: result.line,
      failedStep: result.failedStep,
      errorMessage: result.errorMessage,
    }));

  return {
    durationMs: Date.now() - started,
    report: { summary, failures },
    results,
  };
}

export function analyzeBuiltinConstraintSteps(
  constraints: BuiltinConstraintSource[],
): UnsupportedConstraintStepIssue[] {
  return constraints.flatMap((constraint) =>
    parseConstraintScenarios(constraint).flatMap((scenario) =>
      scenario.steps
        .filter((step) => !isBuiltinConstraintStepSupported(step.text))
        .map((step) => ({
          feature: scenario.feature,
          scenario: scenario.scenario,
          featureFile: constraint.fileRel,
          line: scenario.line,
          step: step.text.trim(),
          stepLine: step.line,
        })),
    ),
  );
}

export function isBuiltinConstraintStepSupported(stepText: string): boolean {
  const text = stepText.trim();
  return Boolean(
    text.match(/^扫描本次新增的 "([^"]*)" 行$/) ||
      text.match(/^scanning added lines in "([^"]*)"$/) ||
      text.match(/^扫描 "([^"]*)"$/) ||
      text.match(/^scanning "([^"]*)"$/) ||
      text.match(/^扫描当前包的 "([^"]*)" 文件$/) ||
      text.match(/^scanning "([^"]*)" files in current package$/) ||
      text.match(/^匹配到 "([^"]*)"$/) ||
      text.match(/^matching "([^"]*)"$/) ||
      text.match(/^匹配到 `([^`]*)`$/) ||
      text.match(/^matching `([^`]*)`$/) ||
      text === "不应该有匹配" ||
      text === "there should be no matches" ||
      text.match(/^应该报错 "([^"]*)"$/) ||
      text.match(/^it should report "([^"]*)"$/) ||
      text.match(/^修正方式为 "([^"]*)"$/) ||
      text.match(/^the fix is "([^"]*)"$/) ||
      text === "应该存在" ||
      text === "should exist" ||
      text === "不应该存在" ||
      text === "should not exist" ||
      text.match(/^运行命令 "([^"]*)"$/) ||
      text.match(/^run command "([^"]*)"$/) ||
      text === "命令应该成功" ||
      text === "command should succeed"
  );
}

export function renderBuiltinConstraintRun(run: BuiltinConstraintRun): string {
  const out: string[] = [];
  const failed = run.report.summary.failed;
  out.push("Built-in constraints");
  out.push(`  exit=${failed > 0 ? 1 : 0}, ${run.durationMs}ms`);
  out.push("");

  const s = run.report.summary;
  out.push(
    `-- Constraint Summary -- total=${s.total} passed=${s.passed} failed=${s.failed} skipped=${s.skipped} pending=${s.pending}`,
  );

  if (run.report.failures.length > 0) {
    out.push("");
    out.push("-- Failures --");
    for (const failure of run.report.failures) {
      out.push(`  x ${failure.feature} > ${failure.scenario}`);
      out.push(`      ${failure.featureFile}${failure.line ? `:${failure.line}` : ""}`);
      if (failure.failedStep) out.push(`      step: ${failure.failedStep}`);
      for (const line of failure.errorMessage.split("\n")) {
        out.push(`      ${line}`);
      }
    }
  }

  return out.join("\n");
}

function parseConstraintScenarios(source: BuiltinConstraintSource): ParsedScenario[] {
  try {
    const idGen = IdGenerator.uuid();
    const builder = new AstBuilder(idGen);
    const matcher = new GherkinClassicTokenMatcher();
    const parser = new Parser(builder, matcher);
    const doc = parser.parse(source.content) as any;
    const feature = doc.feature;
    if (!feature) return [];

    const scenarios: ParsedScenario[] = [];
    for (const child of feature.children ?? []) {
      const scenario = child.scenario;
      if (!scenario) continue;
      scenarios.push({
        feature: feature.name ?? source.title,
        scenario: scenario.name ?? "",
        line: scenario.location?.line,
        steps: (scenario.steps ?? []).map((step: any) => ({
          text: String(step.text ?? ""),
          line: step.location?.line,
        })),
      });
    }
    return scenarios;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [
      {
        feature: source.title,
        scenario: "Parse constraint feature",
        steps: [{ text: `Parse ${source.fileRel}` }],
        line: undefined,
      },
    ].map((scenario) => ({
      ...scenario,
      steps: [
        {
          text: `Unsupported invalid constraint file: ${message}`,
          line: undefined,
        },
      ],
    }));
  }
}

async function runScenario(
  projectRoot: string,
  featureFile: string,
  scenario: ParsedScenario,
): Promise<ConstraintScenarioResult> {
  const world: LintWorld = {
    cwd: projectRoot,
    files: [],
    lineCandidates: null,
    matches: [],
    message: "",
    fix: "",
    execResult: null,
  };

  try {
    let lastStepText = scenario.scenario;
    for (const step of scenario.steps) {
      lastStepText = step.text.trim();
      await runStep(world, step);
    }
    assertNoMatches(world, lastStepText);
    return {
      feature: scenario.feature,
      scenario: scenario.scenario,
      featureFile,
      line: scenario.line,
      status: "passed",
    };
  } catch (e) {
    const failure = e as Error & { failedStep?: string };
    return {
      feature: scenario.feature,
      scenario: scenario.scenario,
      featureFile,
      line: scenario.line,
      status: "failed",
      failedStep: failure.failedStep,
      errorMessage: failure.message,
    };
  }
}

async function runStep(world: LintWorld, step: ParsedStep): Promise<void> {
  const text = step.text.trim();

  let match =
    text.match(/^扫描本次新增的 "([^"]*)" 行$/) ??
    text.match(/^scanning added lines in "([^"]*)"$/);
  if (match?.[1] !== undefined) {
    await scanAddedDiffLines(world, match[1]);
    return;
  }

  match = text.match(/^扫描 "([^"]*)"$/) ?? text.match(/^scanning "([^"]*)"$/);
  if (match?.[1] !== undefined) {
    await scanFiles(world, match[1]);
    return;
  }

  match =
    text.match(/^扫描当前包的 "([^"]*)" 文件$/) ??
    text.match(/^scanning "([^"]*)" files in current package$/);
  if (match?.[1] !== undefined) {
    await scanFiles(world, `src/**/*.${match[1]}`);
    return;
  }

  match =
    text.match(/^匹配到 "([^"]*)"$/) ??
    text.match(/^matching "([^"]*)"$/) ??
    text.match(/^匹配到 `([^`]*)`$/) ??
    text.match(/^matching `([^`]*)`$/);
  if (match?.[1] !== undefined) {
    await matchPattern(world, match[1], text);
    return;
  }

  if (text === "不应该有匹配" || text === "there should be no matches") {
    assertNoMatches(world, text);
    return;
  }

  match =
    text.match(/^应该报错 "([^"]*)"$/) ??
    text.match(/^it should report "([^"]*)"$/);
  if (match?.[1] !== undefined) {
    world.message = match[1];
    return;
  }

  match =
    text.match(/^修正方式为 "([^"]*)"$/) ??
    text.match(/^the fix is "([^"]*)"$/);
  if (match?.[1] !== undefined) {
    world.fix = match[1];
    return;
  }

  if (text === "应该存在" || text === "should exist") {
    assertFilesExist(world, text);
    return;
  }

  if (text === "不应该存在" || text === "should not exist") {
    assertFilesDoNotExist(world, text);
    return;
  }

  match =
    text.match(/^运行命令 "([^"]*)"$/) ??
    text.match(/^run command "([^"]*)"$/);
  if (match?.[1] !== undefined) {
    world.execResult = await runShell(match[1], { cwd: world.cwd });
    return;
  }

  if (text === "命令应该成功" || text === "command should succeed") {
    assertCommandSucceeded(world, text);
    return;
  }

  throw new StepFailure(`Unsupported constraint step: ${text}`, text);
}

async function scanFiles(world: LintWorld, pattern: string): Promise<void> {
  const files: string[] = [];
  const glob = new Glob(pattern);
  for await (const file of glob.scan({ cwd: world.cwd, onlyFiles: true })) {
    const rel = file.replaceAll("\\", "/");
    if (shouldSkipPath(rel)) continue;
    files.push(resolve(world.cwd, file));
  }
  files.sort();
  world.files = files;
  world.lineCandidates = null;
  world.matches = [];
}

async function scanAddedDiffLines(
  world: LintWorld,
  pattern: string,
): Promise<void> {
  const matcher = new Glob(pattern);
  const lines: LintMatch[] = [];

  const check = await runShell("git rev-parse --is-inside-work-tree", {
    cwd: world.cwd,
    timeoutMs: 5_000,
  });
  if (check.exitCode !== 0) {
    world.files = [];
    world.lineCandidates = [];
    world.matches = [];
    return;
  }

  const diff = await runShell("git diff HEAD --no-color --unified=0", {
    cwd: world.cwd,
    timeoutMs: 15_000,
  });
  if (diff.stdout) {
    lines.push(...parseAddedLinesFromDiff(diff.stdout, world.cwd, matcher));
  }

  const untracked = await runShell("git ls-files --others --exclude-standard", {
    cwd: world.cwd,
    timeoutMs: 15_000,
  });
  for (const rel of untracked.stdout.split(/\r?\n/).filter(Boolean)) {
    const normalized = rel.replaceAll("\\", "/");
    if (shouldSkipPath(normalized) || !matcher.match(normalized)) continue;
    try {
      const content = await readFile(resolve(world.cwd, rel), "utf-8");
      const fileLines = content.split(/\r?\n/);
      for (let i = 0; i < fileLines.length; i++) {
        const contentLine = fileLines[i] ?? "";
        if (i === fileLines.length - 1 && contentLine === "") continue;
        lines.push({
          file: normalized,
          line: i + 1,
          content: contentLine.trim(),
        });
      }
    } catch {
      // Ignore unreadable untracked files.
    }
  }

  world.files = [];
  world.lineCandidates = lines;
  world.matches = [];
}

async function matchPattern(
  world: LintWorld,
  pattern: string,
  stepText: string,
): Promise<void> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new StepFailure(`Invalid regex "${pattern}": ${message}`, stepText);
  }

  const matches: LintMatch[] = [];
  if (world.lineCandidates) {
    for (const candidate of world.lineCandidates) {
      if (regex.test(candidate.content)) matches.push(candidate);
      regex.lastIndex = 0;
    }
    world.matches = matches;
    return;
  }

  for (const file of world.files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (regex.test(line)) {
        matches.push({
          file: relative(world.cwd, file),
          line: i + 1,
          content: line.trim(),
        });
      }
      regex.lastIndex = 0;
    }
  }
  world.matches = matches;
}

function assertNoMatches(world: LintWorld, stepText: string): void {
  if (world.matches.length === 0) return;
  throw new StepFailure(formatMatchFailure(world), stepText);
}

function assertFilesExist(world: LintWorld, stepText: string): void {
  if (world.files.length > 0) return;
  throw new StepFailure(formatSimpleFailure(world, "必要文件缺失"), stepText);
}

function assertFilesDoNotExist(world: LintWorld, stepText: string): void {
  if (world.files.length === 0) return;
  const files = world.files.map((file) => relative(world.cwd, file));
  throw new StepFailure(formatSimpleFailure(world, "不应该存在的文件", files), stepText);
}

function assertCommandSucceeded(world: LintWorld, stepText: string): void {
  const result = world.execResult;
  if (result?.exitCode === 0) return;
  const output = result ? (result.stderr || result.stdout).trim() : "no result";
  throw new StepFailure(
    formatSimpleFailure(world, "命令执行失败", output ? [output] : []),
    stepText,
  );
}

function formatMatchFailure(world: LintWorld): string {
  const lines = [world.message || "Lint violation", ""];
  lines.push(...world.matches.map((m) => `${m.file}:${m.line} -> ${m.content}`));
  if (world.fix) {
    lines.push("", `修正: ${world.fix}`);
  }
  return lines.join("\n");
}

function formatSimpleFailure(
  world: LintWorld,
  fallbackMessage: string,
  details: string[] = [],
): string {
  const lines = [world.message || fallbackMessage];
  if (details.length > 0) {
    lines.push("", ...details);
  }
  if (world.fix) {
    lines.push("", `修正: ${world.fix}`);
  }
  return lines.join("\n");
}

function summarize(results: ConstraintScenarioResult[]): ConstraintSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    pending: results.filter((r) => r.status === "pending").length,
  };
}

function shouldSkipPath(rel: string): boolean {
  const segments = rel.split("/");
  return (
    segments.includes("node_modules") ||
    segments.includes("dist") ||
    segments.includes(".git")
  );
}

function parseAddedLinesFromDiff(
  diff: string,
  cwd: string,
  matcher: Glob,
): LintMatch[] {
  const matches: LintMatch[] = [];
  let currentFile = "";
  let currentLine: number | null = null;

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ ")) {
      currentFile = normalizeDiffPath(rawLine.slice(4));
      if (shouldSkipPath(currentFile) || !matcher.match(currentFile)) {
        currentFile = "";
      }
      continue;
    }

    const hunk = rawLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk?.[1] !== undefined) {
      currentLine = Number(hunk[1]);
      continue;
    }

    if (!currentFile || currentLine === null) continue;
    if (rawLine.startsWith("\\ No newline")) continue;

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      matches.push({
        file: currentFile,
        line: currentLine,
        content: rawLine.slice(1).trim(),
      });
      currentLine++;
      continue;
    }

    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      continue;
    }

    currentLine++;
  }

  return matches.map((match) => ({
    ...match,
    file: relative(cwd, resolve(cwd, match.file)),
  }));
}

function normalizeDiffPath(rawPath: string): string {
  if (rawPath === "/dev/null") return "";
  return rawPath.replace(/^"|"$/g, "").replace(/^[ab]\//, "").replaceAll("\\", "/");
}
