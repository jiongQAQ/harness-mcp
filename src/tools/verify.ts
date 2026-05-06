/**
 * F5 verify — 跑外部测试命令并解析报告。
 */
import { resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell } from "../runner.ts";
import { captureGitDiff } from "../git.ts";
import { parseReport, type ParsedReport } from "../parsers/report.ts";
import {
  buildBddCommand,
  checkBddCoverage,
  targetFromCapability,
  type BddCoverageResult,
  type BddTarget,
} from "../bdd.ts";

export const VerifyInputSchema = z.object({
  path: z.string().optional(),
  capability: z
    .string()
    .optional()
    .describe("能力名(模糊匹配,需精确命中 1 个)。不传则跑全部"),
  include_diff: z
    .boolean()
    .optional()
    .default(false)
    .describe("默认 false; true 时附带 git diff。通常失败后让 AI 自行查看 diff 即可"),
  raw: z.boolean().optional(),
});

export type VerifyInput = z.infer<typeof VerifyInputSchema>;

export async function executeVerify(input: VerifyInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;
  if (!loaded.config.bdd) {
    return "harness.yaml 未配置 bdd,无法执行 BDD verify。";
  }

  const caps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  let targets: BddTarget[];
  if (input.capability) {
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
    targets = [await targetFromCapability(matched[0]!)];
  } else {
    targets = await Promise.all(caps.map((cap) => targetFromCapability(cap)));
  }

  if (targets.length === 0) {
    return "未找到可验证的 capability feature。";
  }

  const bddCfg = loaded.config.bdd;
  const workdir = resolve(loaded.projectRoot, bddCfg.workdir ?? ".");
  const cmd = buildBddCommand(bddCfg, targets, { cwd: workdir });

  const runResult = await runShell(cmd, {
    cwd: workdir,
    timeoutMs: bddCfg.timeout_ms,
  });

  let parsed: ParsedReport | null = null;
  const reportPathAbs = resolve(workdir, bddCfg.report.path);
  parsed = await parseReport(bddCfg.report.format, reportPathAbs);
  const coverage = checkBddCoverage(parsed, targets);

  let gitDiff = "";
  let gitTruncated = false;
  if (input.include_diff) {
    const d = await captureGitDiff(loaded.projectRoot);
    gitDiff = d.diff;
    gitTruncated = d.truncated;
  }

  if (input.raw) {
    return JSON.stringify(
      {
        cmd,
        workdir,
        bdd_runner: bddCfg.runner,
        capability: input.capability ? targets[0]?.name ?? null : null,
        targets: targets.map((target) => ({
          kind: target.kind,
          name: target.name,
          title: target.title,
          file: target.fileRel,
          scenarios: target.scenarioNames,
        })),
        exit_code: runResult.exitCode,
        timed_out: runResult.timedOut,
        duration_ms: runResult.durationMs,
        report: parsed,
        report_path: reportPathAbs,
        bdd_coverage: coverage,
        git_diff: input.include_diff ? gitDiff : null,
        git_diff_truncated: input.include_diff ? gitTruncated : false,
        stdout_tail: runResult.stdout.slice(-2000),
        stderr_tail: runResult.stderr.slice(-2000),
      },
      null,
      2,
    );
  }

  return renderVerifyRun({
    cmd,
    workdir,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    durationMs: runResult.durationMs,
    parsed,
    reportPathAbs,
    coverage,
    includeDiff: input.include_diff,
    gitDiff,
    gitTruncated,
    stderr: runResult.stderr,
  });
}

function renderVerifyRun(args: {
  cmd: string;
  workdir: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  parsed: ParsedReport | null;
  reportPathAbs: string;
  coverage: BddCoverageResult;
  includeDiff: boolean;
  gitDiff: string;
  gitTruncated: boolean;
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
        if (f.errorMessage) {
          const firstLine = f.errorMessage.split("\n")[0];
          out.push(`      error: ${firstLine}`);
        }
      }
    }
  } else {
    out.push(`(report 文件未生成或解析失败: ${args.reportPathAbs})`);
  }

  out.push("");
  renderCoverage(args.coverage, out);

  if (args.includeDiff) {
    out.push("");
    if (!args.gitDiff) {
      out.push("── Git Diff ── (无未提交改动 / 非 git 仓库)");
    } else {
      out.push(`── Git Diff (HEAD)${args.gitTruncated ? " — truncated" : ""} ──`);
      out.push(args.gitDiff);
    }
  }

  if (args.stderr.trim()) {
    out.push("");
    out.push("── stderr (tail) ──");
    out.push(args.stderr.slice(-1000).trimEnd());
  }

  return out.join("\n");
}

function renderCoverage(coverage: BddCoverageResult, out: string[]): void {
  out.push(`BDD Coverage: ${coverage.ok ? "PASS" : "FAIL"}`);
  for (const target of coverage.targets) {
    out.push(
      `  ${target.ok ? "✓" : "✗"} ${target.name} -> ${target.file}${
        target.matched_by ? ` (matched by ${target.matched_by})` : ""
      }`,
    );
    if (target.missing_scenarios.length > 0) {
      out.push(`      missing scenarios: ${target.missing_scenarios.join(", ")}`);
    }
  }
}
