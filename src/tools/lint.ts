/**
 * lint - independent AI code-quality gate.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import { loadLintRules, type LintRuleEntry } from "../lint_rules.ts";
import { parseReport, type ParsedReport } from "../parsers/report.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell } from "../runner.ts";

export const LintInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  scope: z.enum(["diff", "all"]).optional().default("diff").describe("diff 只扫本次新增/修改行;all 扫描源文件全文"),
  dryRun: z.boolean().optional().default(false),
  raw: z.boolean().optional(),
});

export type LintInput = z.input<typeof LintInputSchema>;

interface LintRule {
  id: string;
  pattern: RegExp;
  message: string;
  fix: string;
}

interface LintCandidate {
  file: string;
  line: number;
  content: string;
}

interface LintViolation extends LintCandidate {
  rule: string;
  message: string;
  fix: string;
}

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|java|py|go|kt|kts|swift|vue|svelte|cs|php|rb|rs)$/;
const SKIP_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  "coverage",
]);

export async function executeLint(input: LintInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return formatMissingHarnessConfig(root);

  const scope = input.scope ?? "diff";
  const command = loaded.config.commands?.lint;
  const workdir = command ? resolve(loaded.projectRoot, command.workdir ?? ".") : null;
  const loadedRules = await loadLintRules(loaded.specDirAbs);
  if (!loadedRules.ok) return loadedRules.error;
  const candidates = scope === "all"
    ? await collectAllSourceLines(loaded.projectRoot)
    : await collectAddedSourceLines(loaded.projectRoot);
  const customRules = compileCustomRules(loadedRules.rules);
  const customViolations = findViolations(candidates, customRules);

  if (input.dryRun) {
    const payload = {
      command_type: "lint",
      dry_run: true,
      project_root: loaded.projectRoot,
      scope,
      custom_rules: customRules.map((rule) => ({
        id: rule.id,
        message: rule.message,
      })),
      custom_rules_path: loadedRules.path,
      custom_rules_file_exists: loadedRules.exists,
      custom_candidate_count: candidates.length,
      cmd: command?.cmd ?? null,
      workdir,
      report_path: command?.report && workdir ? resolve(workdir, command.report.path) : null,
    };
    return input.raw ? JSON.stringify(payload, null, 2) : renderDryRun(payload);
  }

  let commandResult: Awaited<ReturnType<typeof runShell>> | null = null;
  let parsed: ParsedReport | null = null;
  let reportPathAbs: string | null = null;
  if (command && workdir) {
    commandResult = await runShell(command.cmd, {
      cwd: workdir,
      timeoutMs: command.timeout_ms,
    });
    if (command.report) {
      reportPathAbs = resolve(workdir, command.report.path);
      parsed = await parseReport(command.report.format, reportPathAbs);
    }
  }

  const commandFailed = Boolean(
    commandResult &&
      (commandResult.exitCode !== 0 ||
        commandResult.timedOut ||
        (parsed && parsed.summary.failed > 0)),
  );
  const status = customViolations.length > 0 || commandFailed ? "fail" : "pass";
  const payload = {
    command_type: "lint",
    status,
    project_root: loaded.projectRoot,
    scope,
    custom_summary: {
      checked_lines: candidates.length,
      failed: customViolations.length,
    },
    custom_violations: customViolations,
    custom_rules_path: loadedRules.path,
    custom_rules_file_exists: loadedRules.exists,
    cmd: command?.cmd ?? null,
    workdir,
    exit_code: commandResult?.exitCode ?? null,
    timed_out: commandResult?.timedOut ?? false,
    duration_ms: commandResult?.durationMs ?? 0,
    report: parsed,
    report_path: reportPathAbs,
    stdout_tail: commandResult?.stdout.slice(-2000) ?? "",
    stderr_tail: commandResult?.stderr.slice(-2000) ?? "",
  };

  if (input.raw) return JSON.stringify(payload, null, 2);
  return renderLint(payload);
}

async function collectAddedSourceLines(projectRoot: string): Promise<LintCandidate[]> {
  const check = await runShell("git rev-parse --is-inside-work-tree", {
    cwd: projectRoot,
    timeoutMs: 5_000,
  });
  if (check.exitCode !== 0) return [];

  const candidates: LintCandidate[] = [];
  const diff = await runShell("git diff HEAD --no-color --unified=0", {
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  if (diff.stdout) candidates.push(...parseAddedLinesFromDiff(diff.stdout));

  const untracked = await runShell("git ls-files --others --exclude-standard", {
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  for (const rel of untracked.stdout.split(/\r?\n/).filter(Boolean)) {
    const normalized = normalizePath(rel);
    if (!isSourcePath(normalized)) continue;
    try {
      const content = await readFile(resolve(projectRoot, rel), "utf-8");
      candidates.push(...contentToCandidates(normalized, content));
    } catch {
      // Ignore unreadable untracked files.
    }
  }

  return candidates;
}

async function collectAllSourceLines(projectRoot: string): Promise<LintCandidate[]> {
  if (!existsSync(projectRoot)) return [];
  const glob = new Glob("**/*");
  const candidates: LintCandidate[] = [];
  for await (const rel of glob.scan({ cwd: projectRoot, onlyFiles: true })) {
    const normalized = normalizePath(rel);
    if (!isSourcePath(normalized)) continue;
    try {
      const content = await readFile(resolve(projectRoot, rel), "utf-8");
      candidates.push(...contentToCandidates(normalized, content));
    } catch {
      // Ignore unreadable files.
    }
  }
  return candidates;
}

function compileCustomRules(rules: LintRuleEntry[]): LintRule[] {
  return rules.map((rule) => ({
    id: `custom:${rule.id}`,
    pattern: new RegExp(rule.pattern, rule.flags ?? ""),
    message: rule.message,
    fix: rule.fix,
  }));
}

function findViolations(candidates: LintCandidate[], rules: LintRule[]): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const candidate of candidates) {
    for (const rule of rules) {
      if (!rule.pattern.test(candidate.content)) continue;
      violations.push({
        ...candidate,
        rule: rule.id,
        message: rule.message,
        fix: rule.fix,
      });
      rule.pattern.lastIndex = 0;
    }
  }
  return violations;
}

function parseAddedLinesFromDiff(diff: string): LintCandidate[] {
  const candidates: LintCandidate[] = [];
  let currentFile = "";
  let currentLine: number | null = null;

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ ")) {
      const file = normalizeDiffPath(rawLine.slice(4));
      currentFile = isSourcePath(file) ? file : "";
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
      candidates.push({
        file: currentFile,
        line: currentLine,
        content: rawLine.slice(1).trim(),
      });
      currentLine++;
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) continue;
    currentLine++;
  }

  return candidates;
}

function contentToCandidates(file: string, content: string): LintCandidate[] {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ file, line: index + 1, content: line.trim() }))
    .filter((candidate) => candidate.content.length > 0);
}

function isSourcePath(path: string): boolean {
  if (!SOURCE_FILE_RE.test(path)) return false;
  const segments = path.split("/");
  return !segments.some((segment) => SKIP_SEGMENTS.has(segment));
}

function normalizeDiffPath(rawPath: string): string {
  if (rawPath === "/dev/null") return "";
  return normalizePath(rawPath.replace(/^"|"$/g, "").replace(/^[ab]\//, ""));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function renderDryRun(payload: {
  scope: string;
  custom_rules: { id: string; message: string }[];
  custom_candidate_count: number;
  cmd: string | null;
  workdir: string | null;
}): string {
  return [
    "Lint dry run",
    `scope: ${payload.scope}`,
    `custom candidate lines: ${payload.custom_candidate_count}`,
    `custom rules: ${payload.custom_rules.map((rule) => rule.id).join(", ") || "(none)"}`,
    payload.cmd ? `$ ${payload.cmd}\n  cwd: ${payload.workdir}` : "commands.lint: (not configured)",
  ].join("\n");
}

function renderLint(payload: {
  status: string;
  scope: string;
  custom_summary: { checked_lines: number; failed: number };
  custom_violations: LintViolation[];
  cmd: string | null;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  stderr_tail: string;
}): string {
  const lines = [
    `Lint: ${payload.status.toUpperCase()}`,
    `scope: ${payload.scope}`,
    `custom: checked=${payload.custom_summary.checked_lines} failed=${payload.custom_summary.failed}`,
  ];
  if (payload.cmd) {
    lines.push(`command: exit=${payload.exit_code}${payload.timed_out ? " (TIMED OUT)" : ""}, ${payload.duration_ms}ms`);
  } else {
    lines.push("command: (commands.lint not configured)");
  }
  if (payload.custom_violations.length > 0) {
    lines.push("");
    lines.push("Custom violations:");
    for (const violation of payload.custom_violations) {
      lines.push(`  x ${violation.rule} ${violation.file}:${violation.line}`);
      lines.push(`    ${violation.content}`);
      lines.push(`    ${violation.message}`);
      lines.push(`    fix: ${violation.fix}`);
    }
  }
  if (payload.stderr_tail.trim()) {
    lines.push("");
    lines.push("stderr:");
    lines.push(payload.stderr_tail.trimEnd());
  }
  return lines.join("\n");
}
