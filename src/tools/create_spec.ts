/**
 * create_spec - safely create a new capability spec file.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { discoverCapabilities } from "../capability.ts";
import { loadConfig } from "../config.ts";
import {
  checkFeatureQuality,
  formatFeatureQualityFailure,
} from "../feature_quality.ts";
import { validateGherkin } from "../gherkin.ts";
import { resolveProjectRoot } from "../project.ts";

export const CreateSpecInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  capability: z.string().min(1).describe("新能力唯一标识,例如 demo.createDraft"),
  file: z
    .string()
    .min(1)
    .describe("相对 spec_dir 的 .feature 文件路径,例如 demo/createDraft.feature"),
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
  };

  if (input.raw) return JSON.stringify(payload, null, 2);

  return [
    `已创建 ${payload.file}`,
    `capability: ${payload.capability}`,
    `Feature: ${payload.feature || "?"}`,
    `scenarios: ${payload.scenario_count}`,
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
  if (!file.endsWith(".feature")) {
    return { ok: false, message: "file 必须以 .feature 结尾" };
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

  return {
    ok: true,
    abs,
    fileRel: relative(projectRoot, abs),
  };
}
