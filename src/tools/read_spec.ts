/**
 * F1 read_spec — 按 capability 模糊读单个 .feature 全文
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import { resolveProjectRoot } from "../project.ts";

export const ReadSpecInputSchema = z.object({
  path: z.string().optional(),
  capability: z.string().describe("能力名,模糊匹配(case-insensitive substring)"),
  raw: z.boolean().optional(),
});

export type ReadSpecInput = z.infer<typeof ReadSpecInputSchema>;

export async function executeReadSpec(input: ReadSpecInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) {
    return input.raw
      ? JSON.stringify({ error: "no_config" })
      : `No harness.yaml found at ${root}`;
  }

  const caps = await discoverCapabilities(
    loaded.projectRoot,
    loaded.specDirAbs,
    loaded.charterDirAbs,
  );
  const matched = matchCapabilities(caps, input.capability);

  if (matched.length === 0) {
    if (input.raw) {
      return JSON.stringify({
        error: "not_found",
        query: input.capability,
        candidates: caps.map((c) => c.name),
      });
    }
    return (
      `未找到匹配 "${input.capability}" 的能力。\n` +
      `已存在 ${caps.length} 个:\n` +
      caps.map((c) => `  • ${c.name}`).join("\n")
    );
  }

  if (matched.length > 1) {
    if (input.raw) {
      return JSON.stringify({
        error: "ambiguous",
        query: input.capability,
        matches: matched.map((c) => ({ name: c.name, file: c.fileRel })),
      });
    }
    return (
      `"${input.capability}" 命中 ${matched.length} 个能力,请精确化:\n` +
      matched.map((c) => `  • ${c.name} → ${c.fileRel}`).join("\n")
    );
  }

  const cap = matched[0]!;
  const content = await readFile(cap.fileAbs, "utf-8");

  if (input.raw) {
    return JSON.stringify(
      {
        name: cap.name,
        file: cap.fileRel,
        title: cap.title,
        tags: cap.tags,
        files_linked: cap.filesLinked,
        last_modified: cap.lastModified,
        content,
      },
      null,
      2,
    );
  }

  return [
    `# ${cap.name}`,
    `# file: ${cap.fileRel}`,
    cap.tags.length ? `# tags: ${cap.tags.join(" ")}` : null,
    cap.filesLinked.length ? `# files_linked: ${cap.filesLinked.join(", ")}` : null,
    "",
    content.trimEnd(),
  ]
    .filter((x) => x !== null)
    .join("\n");
}
