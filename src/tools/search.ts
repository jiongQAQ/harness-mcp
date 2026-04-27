/**
 * F8 search — 跨所有 .feature(含 charter)全文搜索,返回匹配行 + 上下文
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { resolveProjectRoot } from "../project.ts";

export const SearchInputSchema = z.object({
  path: z.string().optional(),
  query: z.string().min(1).describe("关键词(case-insensitive substring)"),
  context_lines: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(1)
    .describe("匹配行前后展示行数"),
  raw: z.boolean().optional(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

interface Hit {
  fileRel: string;
  matches: { line: number; text: string; before: string[]; after: string[] }[];
}

export async function executeSearch(input: SearchInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) {
    return input.raw
      ? JSON.stringify({ error: "no_config" })
      : `No harness.yaml found at ${root}`;
  }

  if (!existsSync(loaded.specDirAbs)) {
    return input.raw ? JSON.stringify([]) : "(no spec_dir)";
  }

  const ctx = input.context_lines ?? 1;
  const q = input.query.toLowerCase();
  const hits: Hit[] = [];
  const glob = new Glob("**/*.feature");

  for await (const rel of glob.scan({
    cwd: loaded.specDirAbs,
    onlyFiles: true,
  })) {
    const abs = `${loaded.specDirAbs}/${rel}`;
    const content = await readFile(abs, "utf-8");
    const lines = content.split(/\r?\n/);
    const matches: Hit["matches"] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(q)) {
        matches.push({
          line: i + 1,
          text: lines[i]!,
          before: lines.slice(Math.max(0, i - ctx), i),
          after: lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx)),
        });
      }
    }
    if (matches.length > 0) {
      hits.push({
        fileRel: relative(loaded.projectRoot, abs),
        matches,
      });
    }
  }

  if (input.raw) {
    return JSON.stringify(hits, null, 2);
  }

  if (hits.length === 0) {
    return `(no matches for "${input.query}")`;
  }

  const totalMatches = hits.reduce((n, h) => n + h.matches.length, 0);
  const out: string[] = [
    `${totalMatches} matches in ${hits.length} files for "${input.query}":`,
    "",
  ];
  for (const h of hits) {
    out.push(`── ${h.fileRel} (${h.matches.length}) ──`);
    for (const m of h.matches) {
      for (const b of m.before) out.push(`    ${b}`);
      out.push(`  ${String(m.line).padStart(4)}: ${m.text}`);
      for (const a of m.after) out.push(`    ${a}`);
      out.push("");
    }
  }
  return out.join("\n").trimEnd();
}
