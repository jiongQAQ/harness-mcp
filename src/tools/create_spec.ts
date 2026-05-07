/**
 * create_spec - safely create a new capability spec file.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  findCapabilityMapEntry,
  loadCapabilityMap,
  normalizeMapRelPath,
} from "../capability_map.ts";
import { discoverCapabilities } from "../capability.ts";
import { loadConfig } from "../config.ts";
import {
  checkFeatureQuality,
  formatFeatureQualityFailure,
} from "../feature_quality.ts";
import { validateGherkin } from "../gherkin.ts";
import { resolveProjectRoot } from "../project.ts";
import {
  FEATURE_CONTRACT_REVIEW_ACTION,
  renderNextRequiredAction,
} from "../review_protocol.ts";

export const CreateSpecInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  capability: z.string().min(1).describe("新能力唯一标识,格式建议为 <业务域>.<能力动作>"),
  file: z
    .string()
    .min(1)
    .describe("相对 spec_dir 的 .feature 文件路径,格式为 features/<业务域>/<能力>.feature"),
  content: z.string().min(1).describe("完整 .feature 内容"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type CreateSpecInput = z.infer<typeof CreateSpecInputSchema>;

const CAP_RE = /^#\s*capability:\s*(.+)\s*$/m;

export async function executeCreateSpec(input: CreateSpecInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;

  const target = resolveTargetFile(
    loaded.projectRoot,
    loaded.specDirAbs,
    input.file,
  );
  if (!target.ok) return target.message;

  const mapLoad = await loadCapabilityMap(loaded.specDirAbs);
  if (!mapLoad.exists) {
    return "缺少 capability-map.yaml。请先用 update_map 声明 capability 的 id/file/intent,再 create_spec。";
  }
  if (!mapLoad.ok) {
    return `capability-map.yaml 不合法,请先用 update_map 修正:\n  - ${mapLoad.error}`;
  }
  const mapEntry = findCapabilityMapEntry(mapLoad, input.capability);
  if (!mapEntry) {
    return `能力 ${input.capability} 未在 capability-map.yaml 中声明,请先用 update_map 更新业务能力地图。`;
  }
  if (normalizeMapRelPath(mapEntry.file) !== normalizeMapRelPath(input.file)) {
    return [
      `capability-map.yaml 中 ${input.capability} 的 file 是 ${mapEntry.file}`,
      `当前 create_spec file 是 ${input.file}`,
      "请按 capability-map.yaml 创建,或先用 update_map 调整 map。",
    ].join("\n");
  }

  const existingCaps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  if (existingCaps.some((cap) => cap.name === input.capability)) {
    return `能力已存在: ${input.capability}`;
  }

  if (existsSync(target.abs)) {
    return `文件已存在,拒绝覆盖: ${relative(loaded.projectRoot, target.abs)}`;
  }

  const contentCapability = input.content.match(CAP_RE)?.[1]?.trim();
  if (!contentCapability) {
    return `content 必须包含 # capability: ${input.capability}`;
  }
  if (contentCapability !== input.capability) {
    return `# capability 不匹配: content 是 "${contentCapability}", 参数是 "${input.capability}"`;
  }

  const quality = checkFeatureQuality(input.content, target.fileRel);
  const languageFailure = quality.failures.some(
    (issue) => issue.id === "feature_quality.language",
  );
  if (languageFailure) {
    return formatFeatureQualityFailure(quality, target.fileRel);
  }

  const validation = validateGherkin(input.content);
  if (!validation.ok) {
    return [
      `Gherkin 语法错误,拒绝创建 ${target.fileRel}:`,
      ...validation.errors.map((e) => `  line ${e.line}: ${e.message}`),
    ].join("\n");
  }

  if (!quality.ok) {
    return formatFeatureQualityFailure(quality, target.fileRel);
  }

  await mkdir(dirname(target.abs), { recursive: true });
  await writeFile(target.abs, input.content, "utf-8");

  const payload = {
    ok: true,
    capability: input.capability,
    file: target.fileRel,
    feature: validation.featureName ?? "",
    scenario_count: validation.scenarioCount ?? 0,
    next_required_action: FEATURE_CONTRACT_REVIEW_ACTION,
  };

  if (input.raw) return JSON.stringify(payload, null, 2);

  return [
    `已创建 ${payload.file}`,
    `capability: ${payload.capability}`,
    `Feature: ${payload.feature || "?"}`,
    `scenarios: ${payload.scenario_count}`,
    renderNextRequiredAction(FEATURE_CONTRACT_REVIEW_ACTION),
  ].join("\n");
}

function resolveTargetFile(
  projectRoot: string,
  specDirAbs: string,
  file: string,
): { ok: true; abs: string; fileRel: string } | { ok: false; message: string } {
  if (isAbsolute(file)) {
    return { ok: false, message: "file 必须是 spec_dir 内的相对路径" };
  }
  if (file.includes("\\")) {
    return { ok: false, message: "file 不能包含反斜杠,请使用 / 分隔路径" };
  }
  if (!file.endsWith(".feature")) {
    return { ok: false, message: "file 必须以 .feature 结尾" };
  }
  const rawSegments = file.split("/");
  if (rawSegments.some((segment) => segment === "")) {
    return { ok: false, message: "file 不能包含空路径段" };
  }
  if (rawSegments.some((segment) => segment === ".")) {
    return { ok: false, message: "file 不能包含 . 路径段" };
  }
  if (rawSegments.some((segment) => segment === "..") && !file.startsWith("../")) {
    return { ok: false, message: "file 不能包含 .. 路径段" };
  }

  const abs = resolve(specDirAbs, file);
  const relToSpec = relative(specDirAbs, abs);
  if (
    !relToSpec ||
    relToSpec.startsWith("..") ||
    isAbsolute(relToSpec)
  ) {
    return { ok: false, message: "file 必须是 spec_dir 内的相对路径" };
  }
  const segments = relToSpec.split(/[\\/]+/).filter(Boolean);
  if (segments[0] !== "features" || segments.length < 3) {
    return {
      ok: false,
      message:
        "业务 feature 必须放在 features/<业务域>/ 下,例如 features/<domain>/<capability>.feature",
    };
  }

  return {
    ok: true,
    abs,
    fileRel: relative(projectRoot, abs),
  };
}
