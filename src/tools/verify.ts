/**
 * F5 verify — 跑外部测试命令,解析报告,带 git diff
 */
import { resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell, applyTemplate } from "../runner.ts";
import { captureGitDiff } from "../git.ts";
import { parseCucumberJson, type ParsedReport } from "../parsers/cucumber-json.ts";

export const VerifyInputSchema = z.object({
  path: z.string().optional(),
  capability: z
    .string()
    .optional()
    .describe("能力名(模糊匹配,需精确命中 1 个)。不传则跑全部"),
  include_diff: z.boolean().optional().default(true),
  raw: z.boolean().optional(),
});

export type VerifyInput = z.infer<typeof VerifyInputSchema>;

export async function executeVerify(input: VerifyInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;
  if (!loaded.config.verify) {
    return "harness.yaml 未配置 verify 块,无法执行测试。";
  }

  // 决定 capability(可选)
  let capabilityName: string | undefined;
  if (input.capability) {
    const caps = await discoverCapabilities(
      loaded.projectRoot,
      loaded.specDirAbs,
      loaded.charterDirAbs,
    );
    const matched = matchCapabilities(caps, input.capability);
    if (matched.length === 0) {
      return `未找到能力 "${input.capability}"`;
    }
    if (matched.length > 1) {
      return (
        `"${input.capability}" 命中 ${matched.length} 个,verify 要求精确匹配:\n` +
        matched.map((c) => `  • ${c.name}`).join("\n")
      );
    }
    capabilityName = matched[0]!.name;
  }

  // 拼命令
  const verifyCfg = loaded.config.verify;
  let cmd = verifyCfg.cmd;
  if (capabilityName && verifyCfg.filter_pattern) {
    const filter = applyTemplate(verifyCfg.filter_pattern, {
      capability: capabilityName,
    });
    cmd = `${cmd} ${filter}`;
  }

  // 工作目录
  const workdir = resolve(loaded.projectRoot, verifyCfg.workdir ?? ".");

  // 跑命令
  const runResult = await runShell(cmd, {
    cwd: workdir,
    timeoutMs: verifyCfg.timeout_ms,
  });

  // 解析报告
  let parsed: ParsedReport | null = null;
  let reportPathAbs: string | null = null;
  if (verifyCfg.report) {
    reportPathAbs = resolve(workdir, verifyCfg.report.path);
    if (verifyCfg.report.format === "cucumber-json") {
      parsed = await parseCucumberJson(reportPathAbs);
    }
    // 其他格式待补:surefire-xml / pytest-json
  }

  // git diff
  let gitDiff = "";
  let gitTruncated = false;
  if (input.include_diff !== false) {
    const d = await captureGitDiff(loaded.projectRoot);
    gitDiff = d.diff;
    gitTruncated = d.truncated;
  }

  if (input.raw) {
    return JSON.stringify(
      {
        cmd,
        workdir,
        capability: capabilityName ?? null,
        exit_code: runResult.exitCode,
        timed_out: runResult.timedOut,
        duration_ms: runResult.durationMs,
        report: parsed,
        report_path: reportPathAbs,
        git_diff: gitDiff,
        git_diff_truncated: gitTruncated,
        stdout_tail: runResult.stdout.slice(-2000),
        stderr_tail: runResult.stderr.slice(-2000),
      },
      null,
      2,
    );
  }

  // 文本格式
  const out: string[] = [];
  out.push(`$ ${cmd}`);
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
          const firstLine = f.errorMessage.split("\n")[0];
          out.push(`      error: ${firstLine}`);
        }
      }
    }
  } else if (verifyCfg.report) {
    out.push(`(report 文件未生成或解析失败: ${reportPathAbs})`);
  } else {
    out.push("(harness.yaml 未配置 report,跳过报告解析)");
  }

  // git diff
  if (input.include_diff !== false) {
    out.push("");
    if (!gitDiff) {
      out.push("── Git Diff ── (无未提交改动 / 非 git 仓库)");
    } else {
      out.push(`── Git Diff (HEAD)${gitTruncated ? " — truncated" : ""} ──`);
      out.push(gitDiff);
    }
  }

  // stderr 摘要(若有)
  if (runResult.stderr.trim()) {
    out.push("");
    out.push("── stderr (tail) ──");
    out.push(runResult.stderr.slice(-1000).trimEnd());
  }

  return out.join("\n");
}
