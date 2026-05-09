/**
 * read_source — read or search source evidence documents.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { discoverSources } from "../sources.ts";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";

export const ReadSourceInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则从当前目录向上查找 harness.yaml 或 .git"),
  file: z.string().optional().describe("读取 sources/YYYY-MM-DD-xxx.md"),
  query: z.string().optional().describe("搜索 harness/sources 下的 Markdown 内容"),
  raw: z.boolean().optional(),
});

export type ReadSourceInput = z.infer<typeof ReadSourceInputSchema>;

export async function executeReadSource(input: ReadSourceInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return formatMissingHarnessConfig(root);

  if (input.file) {
    const target = resolveSourcePath(input.file, loaded.specDirAbs, loaded.projectRoot);
    if (!target.ok) return target.message;
    if (!existsSync(target.abs)) return `未找到 source: ${target.specRel}`;
    const content = await readFile(target.abs, "utf-8");
    const payload = {
      file: target.fileRel,
      spec_file: target.specRel,
      content,
    };
    if (input.raw) return JSON.stringify(payload, null, 2);
    return `# ${target.specRel}\nfile: ${target.fileRel}\n\n${content.trimEnd()}`;
  }

  if (input.query) {
    const matches = await searchSources(
      loaded.projectRoot,
      loaded.specDirAbs,
      input.query,
    );
    if (input.raw) return JSON.stringify({ query: input.query, matches }, null, 2);
    if (matches.length === 0) return `未找到 "${input.query}"`;
    return matches.map((match) => `${match.file}:${match.line}: ${match.text}`).join("\n");
  }

  const sources = await discoverSources(loaded.projectRoot, loaded.specDirAbs);
  if (input.raw) return JSON.stringify({ sources }, null, 2);
  if (sources.length === 0) return "Sources: 0";
  return [
    `Sources: ${sources.length}`,
    ...sources.map((source) => `  • ${source.specRel} — ${source.title}`),
  ].join("\n");
}

function resolveSourcePath(
  file: string,
  specDirAbs: string,
  projectRoot: string,
): { ok: true; abs: string; specRel: string; fileRel: string } | { ok: false; message: string } {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (isAbsolute(normalized)) return { ok: false, message: "file 必须是 sources/ 下的相对路径" };
  if (!normalized.startsWith("sources/")) return { ok: false, message: "file 必须以 sources/ 开头" };
  if (normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { ok: false, message: "file 不能包含空路径段、. 或 .." };
  }
  if (!normalized.endsWith(".md")) return { ok: false, message: "file 必须以 .md 结尾" };

  const abs = resolve(specDirAbs, normalized);
  return {
    ok: true,
    abs,
    specRel: normalized,
    fileRel: relative(projectRoot, abs),
  };
}

async function searchSources(
  projectRoot: string,
  specDirAbs: string,
  query: string,
): Promise<{ file: string; line: number; text: string }[]> {
  const sources = await discoverSources(projectRoot, specDirAbs);
  const q = query.toLowerCase();
  const results: { file: string; line: number; text: string }[] = [];
  for (const source of sources) {
    const abs = resolve(specDirAbs, source.specRel);
    const lines = (await readFile(abs, "utf-8")).split(/\r?\n/);
    lines.forEach((text, index) => {
      if (text.toLowerCase().includes(q)) {
        results.push({ file: source.fileRel, line: index + 1, text: text.trim() });
      }
    });
  }
  return results;
}
