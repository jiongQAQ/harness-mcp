/**
 * verify - execute capability or flow BDD feature files and validate fresh report coverage.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import {
  buildBddCommand,
  checkBddCoverage,
  readScenarioNames,
  targetFromCapability,
  type BddCoverageResult,
  type BddTarget,
} from "../bdd.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import { loadCapabilityMap, normalizeMapRelPath } from "../capability_map.ts";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import { captureGitDiff } from "../git.ts";
import { parseReport, type ParsedReport } from "../parsers/report.ts";
import { resolveProjectRoot } from "../project.ts";
import {
  renderNextRequiredAction,
  STEP_EVIDENCE_REVIEW_ACTION,
} from "../review_protocol.ts";
import { runShell } from "../runner.ts";

export const VerifyInputSchema = z.object({
  path: z.string().optional(),
  target_type: z.enum(["capability", "flow"]).optional().default("capability"),
  target: z.string().optional().describe("capability id/title 或 flow 标题/文件名; capability 不传则跑全部"),
  dryRun: z.boolean().optional().default(false),
  include_diff: z.boolean().optional().default(false),
  raw: z.boolean().optional(),
});

export type VerifyInput = z.input<typeof VerifyInputSchema>;

interface FlowSpec {
  id?: string;
  title: string;
  specRel: string;
  fileAbs: string;
  fileRel: string;
  scenarioNames: string[];
}

export async function executeVerify(input: VerifyInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return formatMissingHarnessConfig(root);
  if (!loaded.config.bdd) return "harness.yaml 未配置 bdd,无法执行 BDD verify。";

  const targetType = input.target_type ?? "capability";
  const targets = targetType === "flow"
    ? await resolveFlowTargets(loaded.projectRoot, loaded.specDirAbs, input.target)
    : await resolveCapabilityTargets(loaded.projectRoot, loaded.specDirAbs, loaded.charterDirAbs, input.target);
  if (typeof targets === "string") return targets;
  if (targets.length === 0) return "未找到可验证的 feature。";

  const bddCfg = loaded.config.bdd;
  const workdir = resolve(loaded.projectRoot, bddCfg.workdir ?? ".");
  const cmd = buildBddCommand(bddCfg, targets, { cwd: workdir });
  const reportPathAbs = resolve(workdir, bddCfg.report.path);

  if (input.dryRun) {
    const payload = {
      command_type: "verify",
      dry_run: true,
      target_type: targetType,
      targets: renderTargets(targets),
      cmd,
      workdir,
      report_path: reportPathAbs,
    };
    return input.raw ? JSON.stringify(payload, null, 2) : renderDryRun(payload);
  }

  const beforeMtime = await reportMtime(reportPathAbs);
  const runResult = await runShell(cmd, { cwd: workdir, timeoutMs: bddCfg.timeout_ms });
  const afterMtime = await reportMtime(reportPathAbs);
  const reportFresh = afterMtime !== null && (beforeMtime === null || afterMtime > beforeMtime);

  const parsed = await parseReport(bddCfg.report.format, reportPathAbs);
  const coverage = reportFresh
    ? checkBddCoverage(parsed, targets)
    : staleCoverage(targets);

  let gitDiff = "";
  let gitTruncated = false;
  if (input.include_diff) {
    const d = await captureGitDiff(loaded.projectRoot);
    gitDiff = d.diff;
    gitTruncated = d.truncated;
  }

  const nextRequiredAction = shouldRequireStepEvidenceReview(
    runResult.exitCode,
    runResult.timedOut,
    reportFresh,
    parsed,
    coverage,
  )
    ? STEP_EVIDENCE_REVIEW_ACTION
    : null;

  if (input.raw) {
    return JSON.stringify(
      {
        command_type: "verify",
        target_type: targetType,
        cmd,
        workdir,
        bdd_runner: bddCfg.runner,
        targets: renderTargets(targets),
        exit_code: runResult.exitCode,
        timed_out: runResult.timedOut,
        duration_ms: runResult.durationMs,
        report: parsed,
        report_path: reportPathAbs,
        report_fresh: reportFresh,
        bdd_coverage: coverage,
        next_required_action: nextRequiredAction,
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
    reportFresh,
    coverage,
    nextRequiredAction,
    includeDiff: Boolean(input.include_diff),
    gitDiff,
    gitTruncated,
    stderr: runResult.stderr,
  });
}

async function resolveCapabilityTargets(
  projectRoot: string,
  specDirAbs: string,
  charterDirAbs: string,
  target?: string,
): Promise<BddTarget[] | string> {
  const caps = await discoverCapabilities(projectRoot, specDirAbs, charterDirAbs);
  if (!target) return Promise.all(caps.map((cap) => targetFromCapability(cap)));
  const matched = matchCapabilities(caps, target);
  if (matched.length === 0) return `未找到能力 "${target}"`;
  if (matched.length > 1) {
    return `"${target}" 命中 ${matched.length} 个能力:\n` + matched.map((c) => `  • ${c.name}`).join("\n");
  }
  return [await targetFromCapability(matched[0]!)];
}

async function resolveFlowTargets(
  projectRoot: string,
  specDirAbs: string,
  target?: string,
): Promise<BddTarget[] | string> {
  const map = await loadCapabilityMap(specDirAbs);
  if (map.exists && !map.ok) return map.error;

  const flows = await discoverFlows(projectRoot, specDirAbs);
  if (!target) return "verify flow 需要 target,例如 verify({ target_type: \"flow\", target: \"下单\" })";
  const q = target.toLowerCase().trim();
  const exactIdMatched = flows.filter((flow) => flow.id?.toLowerCase() === q);
  const matched = exactIdMatched.length > 0 ? exactIdMatched : flows.filter(
    (flow) =>
      flow.id?.toLowerCase().includes(q) ||
      flow.title.toLowerCase().includes(q) ||
      flow.fileRel.toLowerCase().includes(q),
  );
  if (matched.length === 0) {
    if (map.exists && map.ok) {
      const declared = map.flows.find((flow) => flow.id.toLowerCase() === q);
      if (declared) return `flow ${target} 的文件不存在: ${declared.file}`;
    }
    return `未找到 flow "${target}"`;
  }
  if (matched.length > 1) {
    return `"${target}" 命中 ${matched.length} 个 flow:\n` + matched.map((f) => `  • ${f.id ?? f.title} -> ${f.fileRel}`).join("\n");
  }
  const flow = matched[0]!;
  return [{
    kind: "flow",
    name: flow.id ?? flow.title,
    title: flow.title,
    fileRel: flow.fileRel,
    fileAbs: flow.fileAbs,
    scenarioNames: flow.scenarioNames,
  }];
}

async function discoverFlows(projectRoot: string, specDirAbs: string): Promise<FlowSpec[]> {
  const flowDirAbs = resolve(specDirAbs, "flows");
  if (!existsSync(flowDirAbs)) return [];
  const map = await loadCapabilityMap(specDirAbs);
  const flowIdByFile = new Map<string, string>();
  if (map.exists && map.ok) {
    for (const flow of map.flows) {
      flowIdByFile.set(normalizeMapRelPath(flow.file), flow.id);
    }
  }
  const glob = new Glob("**/*.feature");
  const flows: FlowSpec[] = [];
  for await (const rel of glob.scan({ cwd: flowDirAbs, onlyFiles: true })) {
    const abs = resolve(flowDirAbs, rel);
    const content = await readFile(abs, "utf-8");
    const title = content.match(/^\s*(?:Feature|功能|機能|Característica):\s*(.+)$/m)?.[1]?.trim() ?? rel.replace(/\.feature$/, "");
    const specRel = `flows/${rel}`.replace(/\\/g, "/");
    flows.push({
      id: flowIdByFile.get(normalizeMapRelPath(specRel)),
      title,
      specRel,
      fileAbs: abs,
      fileRel: relative(projectRoot, abs),
      scenarioNames: await readScenarioNames(abs),
    });
  }
  return flows.sort((a, b) => a.title.localeCompare(b.title));
}

async function reportMtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

function staleCoverage(targets: BddTarget[]): BddCoverageResult {
  return {
    ok: false,
    targets: targets.map((target) => ({
      name: target.name,
      title: target.title,
      file: target.fileRel,
      ok: false,
      missing_scenarios: target.scenarioNames,
      non_passed_scenarios: [],
    })),
  };
}

function shouldRequireStepEvidenceReview(
  exitCode: number,
  timedOut: boolean,
  reportFresh: boolean,
  parsed: ParsedReport | null,
  coverage: BddCoverageResult,
): boolean {
  return Boolean(
    exitCode === 0 &&
      !timedOut &&
      reportFresh &&
      coverage.ok &&
      parsed &&
      parsed.summary.total > 0 &&
      parsed.summary.passed === parsed.summary.total &&
      parsed.summary.failed === 0 &&
      parsed.summary.skipped === 0 &&
      parsed.summary.pending === 0,
  );
}

function renderTargets(targets: BddTarget[]) {
  return targets.map((target) => ({
    kind: target.kind,
    name: target.name,
    title: target.title,
    file: target.fileRel,
    scenarios: target.scenarioNames,
  }));
}

function renderDryRun(payload: { cmd: string; workdir: string; report_path: string; targets: unknown[] }): string {
  return [
    "Verify dry run",
    `$ ${payload.cmd}`,
    `  cwd: ${payload.workdir}`,
    `  report: ${payload.report_path}`,
    `  targets: ${payload.targets.length}`,
  ].join("\n");
}

function renderVerifyRun(args: {
  cmd: string;
  workdir: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  parsed: ParsedReport | null;
  reportPathAbs: string;
  reportFresh: boolean;
  coverage: BddCoverageResult;
  nextRequiredAction: string | null;
  includeDiff: boolean;
  gitDiff: string;
  gitTruncated: boolean;
  stderr: string;
}): string {
  const out: string[] = [];
  out.push(`$ ${args.cmd}`);
  out.push(`  cwd: ${args.workdir}`);
  out.push(`  exit=${args.exitCode}${args.timedOut ? " (TIMED OUT)" : ""}, ${args.durationMs}ms`);
  out.push(`  report_fresh=${args.reportFresh ? "yes" : "no"}`);
  out.push("");

  if (args.parsed) {
    const s = args.parsed.summary;
    out.push(`── Test Summary ── total=${s.total} passed=${s.passed} failed=${s.failed} skipped=${s.skipped} pending=${s.pending}`);
  } else {
    out.push(`(report 文件未生成或解析失败: ${args.reportPathAbs})`);
  }

  out.push("");
  renderCoverage(args.coverage, out);

  if (args.nextRequiredAction) {
    out.push("");
    out.push(renderNextRequiredAction(args.nextRequiredAction));
  }

  if (args.includeDiff) {
    out.push("");
    out.push(args.gitDiff ? `── Git Diff (HEAD)${args.gitTruncated ? " — truncated" : ""} ──\n${args.gitDiff}` : "── Git Diff ── (无未提交改动 / 非 git 仓库)");
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
    out.push(`  ${target.ok ? "✓" : "✗"} ${target.name} -> ${target.file}${target.matched_by ? ` (matched by ${target.matched_by})` : ""}`);
    if (target.missing_scenarios.length > 0) out.push(`      missing scenarios: ${target.missing_scenarios.join(", ")}`);
    if (target.non_passed_scenarios.length > 0) out.push(`      non-passed scenarios: ${target.non_passed_scenarios.join(", ")}`);
  }
}
