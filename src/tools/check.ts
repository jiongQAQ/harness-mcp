/**
 * check - execute governance constraints.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import {
  renderBuiltinConstraintRun,
  runBuiltinConstraints,
} from "../constraint_runner.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell } from "../runner.ts";
import { parseCucumberJson, type ParsedReport } from "../parsers/cucumber-json.ts";

export const CheckInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  dryRun: z.boolean().optional().default(false).describe("只列出约束和命令,不实际运行"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type CheckInput = z.infer<typeof CheckInputSchema>;

interface ConstraintSpec {
  title: string;
  fileAbs: string;
  fileRel: string;
  content: string;
  scenarioCount: number;
  lastModified: string;
}

const TITLE_RE = /^\s*(?:Feature|功能|機能|Característica):\s*(.+)$/m;
const SCENARIO_RE = /^\s*(?:Scenario|场景|場景|Escenario):\s*.+$/gm;

export async function executeCheck(input: CheckInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;

  const constraints = await discoverConstraints(
    loaded.projectRoot,
    loaded.specDirAbs,
  );
  const command = loaded.config.commands?.check;

  if (input.dryRun) {
    const payload = {
      command_type: "check",
      dry_run: true,
      project_root: loaded.projectRoot,
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
    };

    return input.raw ? JSON.stringify(payload, null, 2) : renderDryRun(payload);
  }

  if (!command) {
    const run = await runBuiltinConstraints(loaded.projectRoot, constraints);
    if (input.raw) {
      return JSON.stringify(
        {
          command_type: "check",
          runner: "builtin",
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
    return renderBuiltinConstraintRun(run);
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
    if (command.report.format === "cucumber-json") {
      parsed = await parseCucumberJson(reportPathAbs);
    }
  }

  if (input.raw) {
    return JSON.stringify(
      {
        command_type: "check",
        runner: "command",
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

async function discoverConstraints(
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

function renderDryRun(payload: {
  project_root: string;
  constraint_count: number;
  constraints: { title: string; file: string; scenario_count: number }[];
  cmd: string | null;
  workdir: string | null;
}): string {
  const lines = [
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

  return lines.join("\n");
}

function renderCheckRun(args: {
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
