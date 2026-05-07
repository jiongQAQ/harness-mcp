/**
 * F4 update_spec — 改写已存在能力的 .feature(完整内容覆盖),并校验 Gherkin 语法。
 */
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { z } from "zod";
import {
  findCapabilityMapEntry,
  loadCapabilityMap,
  normalizeMapRelPath,
} from "../capability_map.ts";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import {
  checkFeatureQuality,
  formatFeatureQualityFailure,
} from "../feature_quality.ts";
import { resolveProjectRoot } from "../project.ts";
import { validateGherkin } from "../gherkin.ts";
import {
  FEATURE_CONTRACT_REVIEW_ACTION,
  renderNextRequiredAction,
} from "../review_protocol.ts";

export const UpdateSpecInputSchema = z.object({
  path: z.string().optional(),
  capability: z.string().describe("能力名(必须精确匹配 1 个)"),
  content: z.string().describe(".feature 的完整新内容"),
  allow_invalid_gherkin: z
    .boolean()
    .optional()
    .default(false)
    .describe("默认 false:Gherkin 语法错则拒绝写入。true 则强制写入(慎用)"),
});

export type UpdateSpecInput = z.infer<typeof UpdateSpecInputSchema>;

const CAP_RE = /^#\s*capability:\s*(.+)\s*$/m;

export async function executeUpdateSpec(input: UpdateSpecInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) {
    return `No harness.yaml found at ${root}`;
  }

  const caps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const matched = matchCapabilities(caps, input.capability);
  if (matched.length === 0) {
    return `未找到能力 "${input.capability}"。\n注意:本工具只能修改已存在的能力,不能新建(MVP)。`;
  }
  if (matched.length > 1) {
    return (
      `"${input.capability}" 命中 ${matched.length} 个能力,update_spec 要求精确匹配:\n` +
      matched.map((c) => `  • ${c.name}`).join("\n")
    );
  }

  const cap = matched[0]!;
  const contentCapability = input.content.match(CAP_RE)?.[1]?.trim();
  if (!contentCapability) {
    return `content 必须包含 # capability: ${cap.name}`;
  }

  const currentContent = await readFile(cap.fileAbs, "utf-8");
  const currentCapability = currentContent.match(CAP_RE)?.[1]?.trim();
  const targetCapability = currentCapability ?? contentCapability;
  if (currentCapability && contentCapability !== currentCapability) {
    return `# capability 不匹配: content 是 "${contentCapability}",目标能力是 "${cap.name}"`;
  }

  const mapLoad = await loadCapabilityMap(loaded.specDirAbs);
  if (mapLoad.exists) {
    if (!mapLoad.ok) {
      return `capability-map.yaml 不合法,请先用 update_map 修正:\n  - ${mapLoad.error}`;
    }
    const mapEntry = findCapabilityMapEntry(mapLoad, targetCapability);
    if (!mapEntry) {
      return `能力 ${targetCapability} 未在 capability-map.yaml 中声明,请先用 update_map 更新业务能力地图。`;
    }
    const specRel = relative(loaded.specDirAbs, cap.fileAbs);
    if (normalizeMapRelPath(mapEntry.file) !== normalizeMapRelPath(specRel)) {
      return [
        `capability-map.yaml 中 ${targetCapability} 的 file 是 ${mapEntry.file}`,
        `当前能力文件是 ${specRel}`,
        "请先用 update_map 修正 map,或移动 feature 后再更新。",
      ].join("\n");
    }
  }

  const quality = checkFeatureQuality(input.content, cap.fileRel);
  const languageFailure = quality.failures.some(
    (issue) => issue.id === "feature_quality.language",
  );
  if (languageFailure) {
    return formatFeatureQualityFailure(quality, cap.fileRel);
  }

  // Gherkin 校验
  const validation = validateGherkin(input.content);
  if (!validation.ok && !input.allow_invalid_gherkin) {
    return [
      `❌ Gherkin 语法错误,拒绝写入 ${cap.fileRel}:`,
      ...validation.errors.map((e) => `  line ${e.line}: ${e.message}`),
      "",
      "如确实要写入,加入 allow_invalid_gherkin=true 参数。",
    ].join("\n");
  }

  if (!quality.ok) {
    return formatFeatureQualityFailure(quality, cap.fileRel);
  }

  await writeFile(cap.fileAbs, input.content, "utf-8");

  const lines: string[] = [];
  lines.push(`✅ 已更新 ${cap.fileRel}`);
  if (validation.ok) {
    lines.push(
      `   Gherkin 校验通过(Feature: ${validation.featureName ?? "?"}, ${
        validation.scenarioCount ?? 0
      } 个场景)`,
    );
  } else {
    lines.push("   ⚠️ 强制写入了 Gherkin 不合法的内容:");
    for (const e of validation.errors) {
      lines.push(`     line ${e.line}: ${e.message}`);
    }
  }
  lines.push("");
  lines.push(renderNextRequiredAction(FEATURE_CONTRACT_REVIEW_ACTION));
  lines.push("");
  lines.push("提示: 如果这次改了规格,记得同步实现并跑 verify。");
  return lines.join("\n");
}
