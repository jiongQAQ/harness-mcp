/**
 * init - create the minimal harness structure for a host project.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { resolveProjectRoot } from "../project.ts";

const TargetNameSchema = z.string().regex(/^[a-z0-9_-]+$/, "target 只能包含小写字母、数字、短横线或下划线");

export const InitInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  mode: z.enum(["new", "legacy", "workspace"]).optional().default("new").describe("new 新项目;legacy 旧项目补契约;workspace 子仓库/单目标工作区"),
  targets: z.array(TargetNameSchema).optional().describe("项目允许的验证目标,例如 api/web/e2e"),
  target: TargetNameSchema.optional().describe("workspace 模式下当前工作区允许写入的 target"),
  overwrite: z.boolean().optional().default(false).describe("是否覆盖已存在的初始化文件;默认 false"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type InitInput = z.input<typeof InitInputSchema>;

interface InitFileResult {
  file: string;
  action: "created" | "skipped";
}

export async function executeInit(input: InitInput): Promise<string> {
  const parsed = InitInputSchema.safeParse(input);
  if (!parsed.success) {
    return `init 参数不合法:\n  - ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n  - ")}`;
  }

  const value = parsed.data;
  const root = resolveProjectRoot(value.path);
  const targets = resolveTargets(value.mode, value.targets, value.target);
  if (!targets.ok) return targets.error;

  if (value.mode === "workspace" && !value.target) {
    return "init 参数不合法:\n  - workspace 模式必须传 target";
  }
  if (value.target && !targets.targets.includes(value.target)) {
    return `init 参数不合法:\n  - target ${value.target} 必须包含在 targets 中`;
  }

  const files: InitFileResult[] = [];
  await mkdir(resolve(root, "harness/_charter"), { recursive: true });
  await mkdir(resolve(root, "harness/sources"), { recursive: true });
  await mkdir(resolve(root, "harness/features"), { recursive: true });
  await mkdir(resolve(root, "harness/flows"), { recursive: true });
  await mkdir(resolve(root, "harness/lint"), { recursive: true });
  await mkdir(resolve(root, "harness/agent-skills"), { recursive: true });
  await mkdir(resolve(root, "harness/constraints"), { recursive: true });
  for (const target of targets.targets) {
    await mkdir(resolve(root, "harness/features", target), { recursive: true });
    await mkdir(resolve(root, "harness/flows", target), { recursive: true });
  }

  await writeInitFile(root, "harness.yaml", renderHarnessYaml(targets.targets, value.target), value.overwrite, files);
  await writeInitFile(root, "harness/capability-map.yaml", "version: 1\ndomains: {}\nflows: []\n", value.overwrite, files);
  await writeInitFile(root, "harness/lint/rules.yaml", "version: 1\nrules: []\n", value.overwrite, files);
  await writeInitFile(
    root,
    "harness/_charter/architecture.md",
    "# Architecture\n\n记录系统结构、模块边界、关键依赖和运行时形态。\n",
    value.overwrite,
    files,
  );
  await writeInitFile(
    root,
    "harness/_charter/conventions.md",
    "# Conventions\n\n记录命名、分层、错误处理、测试和代码风格约定。\n",
    value.overwrite,
    files,
  );
  await writeInitFile(
    root,
    "harness/_charter/project-constraints.md",
    "# Project Constraints\n\n记录必须遵守的技术约束、模块依赖方向和禁止事项。\n",
    value.overwrite,
    files,
  );

  const payload = {
    ok: true,
    project_root: root,
    mode: value.mode,
    targets: targets.targets,
    workspace_target: value.target ?? null,
    files,
    next_required_action: "project_context",
    next_steps: nextSteps(value.mode),
  };

  if (value.raw) return JSON.stringify(payload, null, 2);
  return renderInitResult(payload);
}

function resolveTargets(
  mode: "new" | "legacy" | "workspace",
  inputTargets: string[] | undefined,
  workspaceTarget: string | undefined,
): { ok: true; targets: string[] } | { ok: false; error: string } {
  const targets = inputTargets?.length
    ? inputTargets
    : mode === "new"
      ? ["api", "web", "e2e"]
      : mode === "legacy"
        ? ["api"]
        : workspaceTarget
          ? [workspaceTarget]
          : [];

  if (targets.length === 0) {
    return { ok: false, error: "init 参数不合法:\n  - targets 至少声明一个验证目标" };
  }

  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target)) {
      return { ok: false, error: `init 参数不合法:\n  - 重复 target: ${target}` };
    }
    seen.add(target);
  }
  return { ok: true, targets };
}

function renderHarnessYaml(targets: string[], workspaceTarget?: string): string {
  const targetLines = targets.map((target) => `  - ${target}`).join("\n");
  const workspaceBlock = workspaceTarget ? `\nworkspace:\n  target: ${workspaceTarget}\n` : "";
  return `version: 1
spec_dir: harness
charter_dir: harness/_charter
language: zh-CN
targets:
${targetLines}
${workspaceBlock}
`;
}

async function writeInitFile(
  root: string,
  rel: string,
  content: string,
  overwrite: boolean,
  files: InitFileResult[],
): Promise<void> {
  const abs = resolve(root, rel);
  if (existsSync(abs) && !overwrite) {
    files.push({ file: rel, action: "skipped" });
    return;
  }
  await writeFile(abs, content);
  files.push({ file: rel, action: "created" });
}

function nextSteps(mode: "new" | "legacy" | "workspace"): string[] {
  if (mode === "legacy") {
    return [
      "调用 project_context() 确认初始化结果",
      "选择一个真实业务入口,阅读 Controller/Service/SQL/现有测试",
      "调用 discover() 输出业务入口、调用链、业务规则、例子、证据和待确认问题",
    ];
  }
  if (mode === "workspace") {
    return [
      "调用 project_context() 确认 workspace.target 限制",
      "只为当前 target 写 feature 或 flow",
      "跨 target 业务关系通过 capability-map.yaml 对齐,不要在当前工作区顺手补其他 target",
    ];
  }
  return [
    "调用 project_context() 确认初始化结果",
    "先把 PRD、人工确认或代码推断沉淀到 harness/sources/",
    "调用 discover() 完成业务发现,人工确认后再 contract()",
  ];
}

function renderInitResult(payload: {
  ok: boolean;
  project_root: string;
  mode: "new" | "legacy" | "workspace";
  targets: string[];
  workspace_target: string | null;
  files: InitFileResult[];
  next_required_action: string;
  next_steps: string[];
}): string {
  return [
    "harness init",
    `status: ${payload.ok ? "PASS" : "FAIL"}`,
    `project: ${payload.project_root}`,
    `mode: ${payload.mode}`,
    `targets: ${payload.targets.join(", ")}`,
    ...(payload.workspace_target ? [`workspace.target: ${payload.workspace_target}`] : []),
    "",
    "files:",
    ...payload.files.map((file) => `  - ${file.action}: ${file.file}`),
    "",
    `Next required action: ${payload.next_required_action}`,
    ...payload.next_steps.map((step, index) => `  ${index + 1}. ${step}`),
  ].join("\n");
}
