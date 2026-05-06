/**
 * flow - list and execute end-to-end user journeys.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";
import { runShell } from "../runner.ts";
import { parseReport, type ParsedReport } from "../parsers/report.ts";
import {
  buildBddCommand,
  checkBddCoverage,
  readScenarioNames,
  type BddCoverageResult,
  type BddTarget,
} from "../bdd.ts";

export const FlowInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  name: z.string().optional().describe("Flow Feature 标题或文件名的模糊匹配"),
  dryRun: z.boolean().optional().default(false).describe("只展示将执行的命令,不实际运行"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type FlowInput = z.infer<typeof FlowInputSchema>;

interface FlowSpec {
  title: string;
  fileAbs: string;
  fileRel: string;
  scenarioCount: number;
  scenarioNames: string[];
  lastModified: string;
}

const TITLE_RE = /^\s*(?:Feature|功能|機能|Característica):\s*(.+)$/m;
const SCENARIO_RE = /^\s*(?:Scenario|场景|場景|Escenario):\s*.+$/gm;

export async function executeFlow(input: FlowInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;

  const flows = await discoverFlows(loaded.projectRoot, loaded.specDirAbs);
  if (!input.name) {
    return renderFlowList(loaded.projectRoot, flows, input.raw);
  }

  const matched = matchFlows(flows, input.name);
  if (matched.length === 0) {
    return `未找到 flow "${input.name}"。\n已存在 ${flows.length} 个:\n${flows
      .map((f) => `  • ${f.title}`)
      .join("\n")}`;
  }
  if (matched.length > 1) {
    return `"${input.name}" 命中 ${matched.length} 个 flow,请精确化:\n${matched
      .map((f) => `  • ${f.title} -> ${f.fileRel}`)
      .join("\n")}`;
  }

  const flow = matched[0]!;
  const bddCfg = loaded.config.bdd;
  if (!bddCfg) {
    return "harness.yaml 未配置 bdd,无法执行 BDD flow。";
  }
  const target = flowToBddTarget(flow);
  const workdir = resolve(loaded.projectRoot, bddCfg.workdir ?? ".");
  const cmd = buildBddCommand(bddCfg, [target], { cwd: workdir });
  const reportPathAbs = resolve(workdir, bddCfg.report.path);

  if (input.dryRun) {
    const payload = {
      command_type: "flow",
      dry_run: true,
      bdd_runner: bddCfg.runner,
      flow: flow.title,
      file: flow.fileRel,
      scenarios: flow.scenarioNames,
      cmd,
      workdir,
      exit_code: null,
      report: null,
      report_path: reportPathAbs,
      bdd_coverage_rule:
        "parsed report must contain the selected flow feature and all scenarios",
    };
    return input.raw ? JSON.stringify(payload, null, 2) : renderDryRun(payload);
  }

  const runResult = await runShell(cmd, {
    cwd: workdir,
    timeoutMs: bddCfg.timeout_ms,
  });

  let parsed: ParsedReport | null = null;
  parsed = await parseReport(bddCfg.report.format, reportPathAbs);
  const coverage = checkBddCoverage(parsed, [target]);

  if (input.raw) {
    return JSON.stringify(
      {
        command_type: "flow",
        bdd_runner: bddCfg.runner,
        flow: flow.title,
        file: flow.fileRel,
        scenarios: flow.scenarioNames,
        cmd,
        workdir,
        exit_code: runResult.exitCode,
        timed_out: runResult.timedOut,
        duration_ms: runResult.durationMs,
        report: parsed,
        report_path: reportPathAbs,
        bdd_coverage: coverage,
        stdout_tail: runResult.stdout.slice(-2000),
        stderr_tail: runResult.stderr.slice(-2000),
      },
      null,
      2,
    );
  }

  return renderFlowRun({
    cmd,
    workdir,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    durationMs: runResult.durationMs,
    parsed,
    reportPathAbs,
    coverage,
    stderr: runResult.stderr,
  });
}

async function discoverFlows(
  projectRoot: string,
  specDirAbs: string,
): Promise<FlowSpec[]> {
  const flowDirAbs = resolve(specDirAbs, "flows");
  if (!existsSync(flowDirAbs)) return [];

  const glob = new Glob("**/*.feature");
  const result: FlowSpec[] = [];
  for await (const rel of glob.scan({ cwd: flowDirAbs, onlyFiles: true })) {
    const abs = resolve(flowDirAbs, rel);
    const content = await readFile(abs, "utf-8");
    const st = await stat(abs);
    const title = content.match(TITLE_RE)?.[1]?.trim() ?? rel.replace(/\.feature$/, "");
    const scenarioNames = await readScenarioNames(abs);
    const scenarioCount = scenarioNames.length;
    result.push({
      title,
      fileAbs: abs,
      fileRel: relative(projectRoot, abs),
      scenarioCount,
      scenarioNames,
      lastModified: st.mtime.toISOString(),
    });
  }

  return result.sort((a, b) => a.title.localeCompare(b.title));
}

function matchFlows(flows: FlowSpec[], query: string): FlowSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return flows.filter(
    (flow) =>
      flow.title.toLowerCase().includes(q) ||
      flow.fileRel.toLowerCase().includes(q),
  );
}

function renderFlowList(projectRoot: string, flows: FlowSpec[], raw?: boolean): string {
  const payload = {
    project_root: projectRoot,
    flow_count: flows.length,
    flows: flows.map((flow) => ({
      title: flow.title,
      file: flow.fileRel,
      scenario_count: flow.scenarioCount,
      last_modified: flow.lastModified,
    })),
  };

  if (raw) return JSON.stringify(payload, null, 2);

  const lines = [`Flows: ${flows.length}`, `project: ${projectRoot}`, ""];
  if (flows.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }

  for (const flow of flows) {
    lines.push(`- ${flow.title}`);
    lines.push(`    file: ${flow.fileRel}`);
    lines.push(`    scenarios: ${flow.scenarioCount}`);
  }
  return lines.join("\n");
}

function renderDryRun(payload: {
  cmd: string;
  workdir: string;
  flow: string;
  file: string;
  scenarios?: string[];
}): string {
  return [
    "Flow dry run",
    `flow: ${payload.flow}`,
    `file: ${payload.file}`,
    `scenarios: ${payload.scenarios?.length ?? 0}`,
    `$ ${payload.cmd}`,
    `  cwd: ${payload.workdir}`,
  ].join("\n");
}

function renderFlowRun(args: {
  cmd: string;
  workdir: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  parsed: ParsedReport | null;
  reportPathAbs: string;
  coverage: BddCoverageResult;
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
  } else {
    out.push(`(report 文件未生成或解析失败: ${args.reportPathAbs})`);
  }

  out.push("");
  renderCoverage(args.coverage, out);

  if (args.stderr.trim()) {
    out.push("");
    out.push("── stderr (tail) ──");
    out.push(args.stderr.slice(-1000).trimEnd());
  }

  return out.join("\n");
}

function flowToBddTarget(flow: FlowSpec): BddTarget {
  return {
    kind: "flow",
    name: flow.title,
    title: flow.title,
    fileRel: flow.fileRel,
    fileAbs: flow.fileAbs,
    scenarioNames: flow.scenarioNames,
  };
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
