/**
 * F4 update_spec — 改写已存在能力的 .feature(完整内容覆盖),并校验 Gherkin 语法。
 */
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import {
  checkFeatureQuality,
  formatFeatureQualityFailure,
} from "../feature_quality.ts";
import { resolveProjectRoot } from "../project.ts";
import { validateGherkin } from "../gherkin.ts";

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
  lines.push("提示: 如果这次改了规格,记得同步实现并跑 verify。");
  return lines.join("\n");
}
