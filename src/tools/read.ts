/**
 * read - list, read, or search business contracts.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadCapabilityMap } from "../capability_map.ts";
import { discoverCapabilities, matchCapabilities } from "../capability.ts";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";

export const ReadInputSchema = z.object({
  path: z.string().optional(),
  capability: z.string().optional().describe("读取单个 capability,支持模糊匹配"),
  query: z.string().optional().describe("全文搜索 .feature"),
  raw: z.boolean().optional(),
});

export type ReadInput = z.infer<typeof ReadInputSchema>;

export async function executeRead(input: ReadInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return formatMissingHarnessConfig(root);

  if (input.capability) {
    const caps = await discoverCapabilities(loaded.projectRoot, loaded.specDirAbs, loaded.charterDirAbs);
    const matched = matchCapabilities(caps, input.capability);
    if (matched.length === 0) return `未找到能力 "${input.capability}"`;
    if (matched.length > 1) {
      return `"${input.capability}" 命中 ${matched.length} 个能力:\n` + matched.map((c) => `  • ${c.name} -> ${c.fileRel}`).join("\n");
    }
    const cap = matched[0]!;
    const content = await readFile(cap.fileAbs, "utf-8");
    if (input.raw) return JSON.stringify({ capability: cap.name, file: cap.fileRel, content }, null, 2);
    return `# ${cap.name}\nfile: ${cap.fileRel}\n\n${content.trimEnd()}`;
  }

  if (input.query) {
    const matches = await searchFeatures(loaded.projectRoot, loaded.specDirAbs, input.query);
    if (input.raw) return JSON.stringify({ query: input.query, matches }, null, 2);
    if (matches.length === 0) return `未找到 "${input.query}"`;
    return matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
  }

  const caps = await discoverCapabilities(loaded.projectRoot, loaded.specDirAbs, loaded.charterDirAbs);
  const map = await loadCapabilityMap(loaded.specDirAbs);
  const payload = {
    project_root: loaded.projectRoot,
    capability_map:
      !map.exists
        ? null
        : map.ok
          ? { capabilities: map.capabilities, flows: map.flows }
          : { error: map.error },
    capabilities: caps.map((cap) => ({ name: cap.name, file: cap.fileRel, title: cap.title, tags: cap.tags })),
  };
  if (input.raw) return JSON.stringify(payload, null, 2);
  const lines: string[] = [];
  if (map.exists && !map.ok) {
    lines.push("Capability Map: invalid");
    lines.push(map.error);
    lines.push("");
  }
  lines.push(
    `Capabilities: ${payload.capabilities.length}`,
    ...payload.capabilities.map((cap) => `  • ${cap.name} -> ${cap.file}`),
  );
  return lines.join("\n");
}

async function searchFeatures(projectRoot: string, specDirAbs: string, query: string) {
  if (!existsSync(specDirAbs)) return [];
  const q = query.toLowerCase();
  const glob = new Glob("**/*.feature");
  const results: { file: string; line: number; text: string }[] = [];
  for await (const rel of glob.scan({ cwd: specDirAbs, onlyFiles: true })) {
    const abs = resolve(specDirAbs, rel);
    const lines = (await readFile(abs, "utf-8")).split(/\r?\n/);
    lines.forEach((text, index) => {
      if (text.toLowerCase().includes(q)) {
        results.push({ file: relative(projectRoot, abs), line: index + 1, text: text.trim() });
      }
    });
  }
  return results;
}
