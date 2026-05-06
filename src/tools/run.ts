/**
 * run - execute normal host-project business checks.
 */
import { resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell } from "../runner.ts";
import { parseReport, type ParsedReport } from "../parsers/report.ts";

export const RunInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type RunInput = z.infer<typeof RunInputSchema>;

export async function executeRun(input: RunInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;

  const command = loaded.config.commands?.run;
  if (!command) {
    return "harness.yaml 未配置 commands.run,无法执行 run。";
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

  if (input.raw) {
    return JSON.stringify(
      {
        command_type: "run",
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

  const out: string[] = [];
  out.push(`$ ${command.cmd}`);
  out.push(`  cwd: ${workdir}`);
  out.push(
    `  exit=${runResult.exitCode}${runResult.timedOut ? " (TIMED OUT)" : ""}, ${
      runResult.durationMs
    }ms`,
  );
  out.push("");

  if (parsed) {
    const s = parsed.summary;
    out.push(
      `── Test Summary ── total=${s.total} passed=${s.passed} failed=${s.failed} skipped=${s.skipped} pending=${s.pending}`,
    );
    if (parsed.failures.length > 0) {
      out.push("");
      out.push("── Failures ──");
      for (const f of parsed.failures) {
        out.push(`  ✗ ${f.feature} › ${f.scenario}`);
        if (f.featureFile) out.push(`      ${f.featureFile}${f.line ? `:${f.line}` : ""}`);
        if (f.failedStep) out.push(`      step: ${f.failedStep}`);
        if (f.errorMessage) {
          out.push(`      error: ${f.errorMessage.split("\n")[0]}`);
        }
      }
    }
  } else if (command.report) {
    out.push(`(report 文件未生成或解析失败: ${reportPathAbs})`);
  } else {
    out.push("(harness.yaml 未配置 report,跳过报告解析)");
  }

  if (runResult.stderr.trim()) {
    out.push("");
    out.push("── stderr (tail) ──");
    out.push(runResult.stderr.slice(-1000).trimEnd());
  }

  return out.join("\n");
}
