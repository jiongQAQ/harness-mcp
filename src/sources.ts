/**
 * Source traceability for business contracts.
 *
 * Source documents live under spec_dir/sources. source-map.yaml optionally
 * links capabilities and rules to the source document timeline.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { scanFiles } from "./glob.ts";

export interface SourceDocument {
  fileRel: string;
  specRel: string;
  sourceRel: string;
  title: string;
  date: string | null;
  validDateName: boolean;
}

export interface SourceIssue {
  id: string;
  level: "fail";
  message: string;
  detail?: string;
}

interface SourceBlock {
  current: string;
  timeline: string[];
}

const SourceRefBlockSchema = z.object({
  current: z.string().min(1),
  timeline: z.array(z.string().min(1)).min(1),
}).strict();

const SourceMapCapabilitySchema = SourceRefBlockSchema.extend({
  rules: z.record(z.string(), SourceRefBlockSchema).optional().default({}),
}).strict();

const SourceMapSchema = z.object({
  version: z.literal(1),
  capabilities: z.record(z.string(), SourceMapCapabilitySchema).default({}),
}).strict();

const SOURCE_FILE_RE = /^(\d{4}-\d{2}-\d{2})-[^/]+\.md$/;
const SOURCE_REF_RE = /^sources\/(\d{4}-\d{2}-\d{2})-[^/#]+\.md(?:#.+)?$/;

export const SOURCE_MAP_EXAMPLE = `version: 1
capabilities:
  api.order.create:
    current: sources/2026-05-10-order-confirmed.md#创建订单
    timeline:
      - sources/2026-05-08-order-code-inference.md#创建订单
      - sources/2026-05-10-order-confirmed.md#创建订单
    rules:
      有库存商品可以创建订单:
        current: sources/2026-05-10-order-confirmed.md#库存规则
        timeline:
          - sources/2026-05-08-order-code-inference.md#库存规则
          - sources/2026-05-10-order-confirmed.md#库存规则
`;

export const SOURCE_MAP_SCHEMA_HELP = [
  "正确位置:",
  "  - .harness/source-map.yaml",
  "",
  "正确格式:",
  "```yaml",
  SOURCE_MAP_EXAMPLE.trimEnd(),
  "```",
  "",
  "说明:",
  "  - source-map.yaml 可选;存在时 check 会校验格式和引用文件",
  "  - current 表示当前生效来源,必须出现在 timeline 中",
  "  - timeline 按来源文件日期从旧到新排列",
  "  - 引用路径必须是 sources/YYYY-MM-DD-xxx.md 或 sources/YYYY-MM-DD-xxx.md#章节",
].join("\n");

export async function discoverSources(
  projectRoot: string,
  specDirAbs: string,
): Promise<SourceDocument[]> {
  const sourcesDir = resolve(specDirAbs, "sources");
  if (!existsSync(sourcesDir)) return [];

  const result: SourceDocument[] = [];
  for (const rel of await scanFiles(sourcesDir, "**/*.md")) {
    const normalized = rel;
    const abs = resolve(sourcesDir, rel);
    const content = await readFile(abs, "utf-8");
    const directFile = !normalized.includes("/");
    const dateMatch = directFile ? normalized.match(SOURCE_FILE_RE) : null;
    result.push({
      fileRel: relative(projectRoot, abs),
      specRel: `sources/${normalized}`,
      sourceRel: normalized,
      title: extractMarkdownTitle(content) ?? normalized.replace(/\.md$/, ""),
      date: dateMatch?.[1] ?? null,
      validDateName: Boolean(dateMatch),
    });
  }

  return result.sort((a, b) => a.specRel.localeCompare(b.specRel));
}

export async function checkSourceFiles(
  projectRoot: string,
  specDirAbs: string,
): Promise<SourceIssue[]> {
  const sources = await discoverSources(projectRoot, specDirAbs);
  const invalid = sources.filter((source) => !source.validDateName);
  if (invalid.length === 0) return [];
  return [{
    id: "sources.files.date_name",
    level: "fail",
    message: "source 文件必须直接放在 sources/ 下,并使用 YYYY-MM-DD-xxx.md 命名",
    detail: invalid.map((source) => source.fileRel).join("; "),
  }];
}

export async function checkSourceMap(
  projectRoot: string,
  specDirAbs: string,
): Promise<SourceIssue[]> {
  const mapPath = resolve(specDirAbs, "source-map.yaml");
  if (!existsSync(mapPath)) return [];

  const fileRel = relative(projectRoot, mapPath);
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(mapPath, "utf-8"));
  } catch (error) {
    return [{
      id: "source_map.format",
      level: "fail",
      message: `source-map.yaml YAML 解析失败: ${(error as Error).message}`,
      detail: fileRel,
    }];
  }

  const result = SourceMapSchema.safeParse(parsed);
  if (!result.success) {
    return [{
      id: "source_map.format",
      level: "fail",
      message: "source-map.yaml 格式错误",
      detail: `${fileRel}: ${formatZodIssues(result.error.issues)}`,
    }];
  }

  const issues: SourceIssue[] = [];
  for (const [capabilityId, block] of Object.entries(result.data.capabilities)) {
    issues.push(...validateBlock(block, capabilityId, specDirAbs));
    for (const [ruleName, ruleBlock] of Object.entries(block.rules)) {
      issues.push(...validateBlock(ruleBlock, `${capabilityId}.rules.${ruleName}`, specDirAbs));
    }
  }
  return issues;
}

export function extractSourceFileFromRef(ref: string): string {
  return ref.split("#")[0] ?? ref;
}

function validateBlock(
  block: SourceBlock,
  location: string,
  specDirAbs: string,
): SourceIssue[] {
  const issues: SourceIssue[] = [];

  if (!block.timeline.includes(block.current)) {
    issues.push({
      id: "source_map.current_in_timeline",
      level: "fail",
      message: `current 必须出现在 timeline 中: ${block.current}`,
      detail: location,
    });
  }

  const refs = [...new Set([block.current, ...block.timeline])];
  for (const ref of refs) {
    const match = ref.match(SOURCE_REF_RE);
    if (!match) {
      issues.push({
        id: "source_map.format",
        level: "fail",
        message: `source 引用必须使用 sources/YYYY-MM-DD-xxx.md#章节: ${ref}`,
        detail: location,
      });
      continue;
    }

    const filePart = extractSourceFileFromRef(ref);
    if (!existsSync(resolve(specDirAbs, filePart))) {
      issues.push({
        id: "source_map.exists",
        level: "fail",
        message: `source 文件不存在: ${filePart}`,
        detail: location,
      });
    }
  }

  const dates = block.timeline.map((ref) => ref.match(SOURCE_REF_RE)?.[1] ?? "");
  for (let index = 1; index < dates.length; index++) {
    if (dates[index - 1]! > dates[index]!) {
      issues.push({
        id: "source_map.timeline_order",
        level: "fail",
        message: "timeline 必须按 source 文件日期从旧到新排列",
        detail: `${location}: ${block.timeline.join(" -> ")}`,
      });
      break;
    }
  }

  return issues;
}

function extractMarkdownTitle(content: string): string | null {
  return content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
