/**
 * Source traceability for business contracts.
 *
 * Source files live under harness/sources and feature Rule/Scenario blocks
 * reference them with a fixed YAML-shaped comment block.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Glob } from "bun";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

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

export interface FeatureSourceResult {
  ok: boolean;
  issues: SourceIssue[];
}

interface SourceBlock {
  current: string;
  timeline: string[];
}

interface Heading {
  kind: "rule" | "scenario";
  title: string;
  lineIndex: number;
  lineNumber: number;
}

interface ParsedBlock {
  present: boolean;
  block?: SourceBlock;
  issues: SourceIssue[];
}

const SourceBlockSchema = z.object({
  sources: z.object({
    current: z.string().min(1),
    timeline: z.array(z.string().min(1)).min(1),
  }).strict(),
}).strict();

const SOURCE_FILE_RE = /^(\d{4}-\d{2}-\d{2})-[^/]+\.md$/;
const SOURCE_REF_RE = /^sources\/(\d{4}-\d{2}-\d{2})-[^/#]+\.md(?:#.+)?$/;

export const SOURCE_BLOCK_TEMPLATE = [
  "# sources:",
  "#   current: sources/YYYY-MM-DD-name.md#section",
  "#   timeline:",
  "#     - sources/YYYY-MM-DD-name.md#section",
].join("\n");

export async function discoverSources(
  projectRoot: string,
  specDirAbs: string,
): Promise<SourceDocument[]> {
  const sourcesDir = resolve(specDirAbs, "sources");
  if (!existsSync(sourcesDir)) return [];

  const glob = new Glob("**/*.md");
  const result: SourceDocument[] = [];
  for await (const rel of glob.scan({ cwd: sourcesDir, onlyFiles: true })) {
    const normalized = rel.replace(/\\/g, "/");
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

export async function checkFeatureSources(
  content: string,
  fileRel: string,
  specDirAbs: string,
): Promise<FeatureSourceResult> {
  const headings = collectHeadings(content);
  const rules = headings.filter((heading) => heading.kind === "rule");
  const issues: SourceIssue[] = [];
  const blockByHeading = new Map<number, ParsedBlock>();

  for (const heading of headings) {
    const parsed = parseBlockAfterHeading(content, heading);
    blockByHeading.set(heading.lineIndex, parsed);
    issues.push(...parsed.issues);
    if (parsed.block) {
      issues.push(...validateBlock(parsed.block, heading, fileRel, specDirAbs));
    }
  }

  const firstRuleLine = rules[0]?.lineIndex ?? Number.POSITIVE_INFINITY;
  for (const scenario of headings.filter((heading) => heading.kind === "scenario" && heading.lineIndex < firstRuleLine)) {
    const scenarioBlock = blockByHeading.get(scenario.lineIndex)!;
    if (scenarioBlock.block) continue;
    if (scenarioBlock.present && scenarioBlock.issues.length > 0) continue;
    issues.push(missingSourcesIssue(scenario, fileRel));
  }

  for (const [index, rule] of rules.entries()) {
    const nextRuleLine = rules[index + 1]?.lineIndex ?? Number.POSITIVE_INFINITY;
    const ruleBlock = blockByHeading.get(rule.lineIndex)!;
    if (ruleBlock.block) continue;
    if (ruleBlock.present && ruleBlock.issues.length > 0) continue;

    const scenarios = headings.filter(
      (heading) =>
        heading.kind === "scenario" &&
        heading.lineIndex > rule.lineIndex &&
        heading.lineIndex < nextRuleLine,
    );

    if (scenarios.length === 0) {
      issues.push(missingSourcesIssue(rule, fileRel));
      continue;
    }

    for (const scenario of scenarios) {
      const scenarioBlock = blockByHeading.get(scenario.lineIndex)!;
      if (scenarioBlock.block) continue;
      if (scenarioBlock.present && scenarioBlock.issues.length > 0) continue;
      issues.push(missingSourcesIssue(scenario, fileRel, rule.title));
    }
  }

  return { ok: issues.length === 0, issues };
}

export function formatFeatureSourceFailure(
  result: FeatureSourceResult,
  fileRel: string,
): string {
  return [
    `Feature sources 检查失败: ${fileRel}`,
    ...result.issues.map((issue) => `  - [${issue.id}] ${issue.message}${issue.detail ? ` (${issue.detail})` : ""}`),
    "",
    "标准格式:",
    SOURCE_BLOCK_TEMPLATE,
  ].join("\n");
}

export function extractSourceFileFromRef(ref: string): string {
  return ref.split("#")[0] ?? ref;
}

function collectHeadings(content: string): Heading[] {
  const result: Heading[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const rule = line.match(/^\s*(?:Rule|规则|規則):\s*(.+)$/);
    if (rule?.[1]) {
      result.push({ kind: "rule", title: rule[1].trim(), lineIndex: index, lineNumber: index + 1 });
      return;
    }

    const scenario = line.match(/^\s*(?:Scenario|场景|場景|Escenario):\s*(.+)$/);
    if (scenario?.[1]) {
      result.push({ kind: "scenario", title: scenario[1].trim(), lineIndex: index, lineNumber: index + 1 });
    }
  });
  return result;
}

function parseBlockAfterHeading(content: string, heading: Heading): ParsedBlock {
  const lines = content.split(/\r?\n/);
  let index = heading.lineIndex + 1;
  while (index < lines.length && lines[index]!.trim() === "") index++;

  const comments: string[] = [];
  while (index < lines.length && /^\s*#/.test(lines[index]!)) {
    comments.push(lines[index]!.replace(/^\s*# ?/, ""));
    index++;
  }

  if (comments.length === 0) return { present: false, issues: [] };

  const first = comments[0]!.trim();
  if (first !== "sources:") {
    if (/source|sources|来源|PRD|prd|reference|references/.test(comments.join("\n"))) {
      return {
        present: true,
        issues: [{
          id: "feature_sources.format",
          level: "fail",
          message: `${headingLabel(heading)} "${heading.title}" 的来源注释必须使用固定 # sources: 格式`,
          detail: `line ${heading.lineNumber}`,
        }],
      };
    }
    return { present: false, issues: [] };
  }

  const yamlText = comments.join("\n");
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (e) {
    return {
      present: true,
      issues: [{
        id: "feature_sources.format",
        level: "fail",
        message: `sources YAML 解析失败: ${(e as Error).message}`,
        detail: `line ${heading.lineNumber}`,
      }],
    };
  }

  const result = SourceBlockSchema.safeParse(parsed);
  if (!result.success) {
    return {
      present: true,
      issues: [{
        id: "feature_sources.format",
        level: "fail",
        message: "sources 注释块只能包含 current 和 timeline 字段",
        detail: `line ${heading.lineNumber}: ${result.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ")}`,
      }],
    };
  }

  return { present: true, block: result.data.sources, issues: [] };
}

function validateBlock(
  block: SourceBlock,
  heading: Heading,
  fileRel: string,
  specDirAbs: string,
): SourceIssue[] {
  const issues: SourceIssue[] = [];
  const location = `${fileRel}: line ${heading.lineNumber}`;

  if (!block.timeline.includes(block.current)) {
    issues.push({
      id: "feature_sources.current_in_timeline",
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
        id: "feature_sources.format",
        level: "fail",
        message: `source 引用必须使用 sources/YYYY-MM-DD-xxx.md#章节: ${ref}`,
        detail: location,
      });
      continue;
    }

    const filePart = extractSourceFileFromRef(ref);
    if (!existsSync(resolve(specDirAbs, filePart))) {
      issues.push({
        id: "feature_sources.exists",
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
        id: "feature_sources.timeline_order",
        level: "fail",
        message: "timeline 必须按 source 文件日期从旧到新排列",
        detail: `${location}: ${block.timeline.join(" -> ")}`,
      });
      break;
    }
  }

  return issues;
}

function missingSourcesIssue(heading: Heading, fileRel: string, ruleTitle?: string): SourceIssue {
  return {
    id: "feature_sources.required",
    level: "fail",
    message: ruleTitle
      ? `场景 "${heading.title}" 缺少 sources 注释块;其所属规则 "${ruleTitle}" 也没有 sources`
      : `规则 "${heading.title}" 缺少 sources 注释块`,
    detail: `${fileRel}: line ${heading.lineNumber}`,
  };
}

function extractMarkdownTitle(content: string): string | null {
  return content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function headingLabel(heading: Heading): string {
  return heading.kind === "rule" ? "规则" : "场景";
}
