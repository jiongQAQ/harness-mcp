/**
 * update_map - write and validate harness/capability-map.yaml.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { z } from "zod";
import {
  capabilityMapPath,
  flattenCapabilityMap,
  parseCapabilityMapContent,
} from "../capability_map.ts";
import { loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";

export const UpdateMapInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则用 HARNESS_PROJECT_ROOT 或 cwd"),
  content: z.string().min(1).describe("完整 capability-map.yaml 内容"),
  raw: z.boolean().optional().describe("true 返回 JSON,false/缺省 返回格式化文本"),
});

export type UpdateMapInput = z.infer<typeof UpdateMapInputSchema>;

export async function executeUpdateMap(input: UpdateMapInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return `No harness.yaml found at ${root}`;

  const parsed = parseCapabilityMapContent(input.content);
  if (!parsed.ok) {
    return `capability-map.yaml 校验失败:\n  - ${parsed.error}`;
  }

  const target = capabilityMapPath(loaded.specDirAbs);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, input.content, "utf-8");

  const capabilities = flattenCapabilityMap(parsed.map);
  const payload = {
    ok: true,
    file: relative(loaded.projectRoot, target),
    capability_count: capabilities.length,
    flow_count: parsed.map.flows.length,
  };

  if (input.raw) return JSON.stringify(payload, null, 2);

  return [
    `已更新 ${payload.file}`,
    `capabilities: ${payload.capability_count}`,
    `flows: ${payload.flow_count}`,
  ].join("\n");
}
