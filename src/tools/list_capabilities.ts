/**
 * F2 list_capabilities — 列出所有能力(可选 tag/前缀过滤)
 */
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";

export const ListCapabilitiesInputSchema = z.object({
  path: z.string().optional(),
  tag: z.string().optional().describe("按 @tag 过滤(精确匹配,带或不带 @ 都行)"),
  prefix: z.string().optional().describe("按 capability name 前缀过滤"),
  raw: z.boolean().optional(),
});

export type ListCapabilitiesInput = z.infer<typeof ListCapabilitiesInputSchema>;

export async function executeListCapabilities(
  input: ListCapabilitiesInput,
): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);

  if (!loaded) {
    return input.raw
      ? JSON.stringify({ error: "no_config" })
      : `No harness.yaml found at ${root}`;
  }

  let caps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );

  if (input.tag) {
    const want = input.tag.startsWith("@") ? input.tag : `@${input.tag}`;
    caps = caps.filter((c) => c.tags.includes(want));
  }
  if (input.prefix) {
    const p = input.prefix.toLowerCase();
    caps = caps.filter((c) => c.name.toLowerCase().startsWith(p));
  }

  if (input.raw) {
    return JSON.stringify(
      caps.map((c) => ({
        name: c.name,
        file: c.fileRel,
        title: c.title,
        tags: c.tags,
        files_linked: c.filesLinked,
        last_modified: c.lastModified,
      })),
      null,
      2,
    );
  }

  if (caps.length === 0) {
    return "(no capabilities)";
  }
  const lines = [`${caps.length} capabilities:`];
  for (const c of caps) {
    const tagStr = c.tags.length ? ` ${c.tags.join(" ")}` : "";
    lines.push(`  • ${c.name}${tagStr}`);
    if (c.title) lines.push(`      ${c.title}`);
    lines.push(`      → ${c.fileRel}`);
  }
  return lines.join("\n");
}
