/**
 * Source traceability for business contracts.
 *
 * Source files live under harness/sources. A feature file may declare an
 * optional file-level sources block; Rule/Scenario blocks may override it.
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

export interface FeatureSourceResult {
  ok: boolean;
  issues: SourceIssue[];
}

interface SourceBlock {
  current: string;
  timeline: string[];
}

interface Heading {
  kind: "feature" | "rule" | "scenario";
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

export async function checkFeatureSources(
  content: string,
  fileRel: string,
  specDirAbs: string,
): Promise<FeatureSourceResult> {
  const headings = collectHeadings(content);
  const issues: SourceIssue[] = [];
  const featureBlock = parseFeatureHeaderBlock(content, fileRel);
  issues.push(...featureBlock.issues);
  if (featureBlock.block) {
    issues.push(...validateBlock(featureBlock.block, featureHeaderHeading(fileRel), fileRel, specDirAbs));
  }

  for (const heading of headings) {
    const parsed = parseBlockAfterHeading(content, heading);
    issues.push(...parsed.issues);
    if (parsed.block) {
      issues.push(...validateBlock(parsed.block, heading, fileRel, specDirAbs));
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
    const rule = line.match(ruleHeadingRe);
    if (rule?.[1]) {
      result.push({ kind: "rule", title: rule[1].trim(), lineIndex: index, lineNumber: index + 1 });
      return;
    }

    const scenario = line.match(scenarioHeadingRe);
    if (scenario?.[1]) {
      result.push({ kind: "scenario", title: scenario[1].trim(), lineIndex: index, lineNumber: index + 1 });
    }
  });
  return result;
}

const ruleHeadingRe = /^\s*(?:Rule|规则|規則):\s*(.+)$/;
const scenarioHeadingRe = /^\s*(?:Scenario|场景|場景|Escenario):\s*(.+)$/;
const featureHeadingRe = /^\s*(?:Feature|功能|機能|Característica):\s*(.+)$/;
const englishStepRe = /^(?:Given|When|Then|And|But)\b/;
const chineseStepRe = /^(?:假设|假如|当|那么|则|并且|而且|但是)/;

function parseFeatureHeaderBlock(content: string, fileRel: string): ParsedBlock {
  const lines = content.split(/\r?\n/);
  const featureLine = lines.findIndex((line) => featureHeadingRe.test(line));
  const end = featureLine === -1 ? lines.length : featureLine;
  const comments = findSourceCommentBlock(lines, 0, end);
  const heading = featureHeaderHeading(fileRel);

  if (!comments) {
    if (hasSourceLikeComment(lines, 0, end)) {
      return {
        present: true,
        issues: [{
          id: "feature_sources.format",
          level: "fail",
          message: `${headingLabel(heading)} "${heading.title}" 的来源注释必须使用固定 # sources: 格式`,
          detail: `line 1`,
        }],
      };
    }
    return { present: false, issues: [] };
  }

  return parseSourceComments(comments, heading);
}

function featureHeaderHeading(fileRel: string): Heading {
  return { kind: "feature", title: fileRel, lineIndex: -1, lineNumber: 1 };
}

function parseBlockAfterHeading(content: string, heading: Heading): ParsedBlock {
  const lines = content.split(/\r?\n/);
  const start = heading.lineIndex + 1;
  const end = sourcePreambleEnd(lines, heading);
  const comments = findSourceCommentBlock(lines, start, end);

  if (!comments) {
    if (hasSourceLikeComment(lines, start, end)) {
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

  return parseSourceComments(comments, heading);
}

function parseSourceComments(comments: string[], heading: Heading): ParsedBlock {
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

function sourcePreambleEnd(lines: string[], heading: Heading): number {
  for (let index = heading.lineIndex + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (isRuleHeading(line)) return index;
    if (heading.kind === "rule" && isScenarioHeading(line)) return index;
    if (heading.kind === "scenario" && (isScenarioHeading(line) || isStepLine(line))) return index;
  }
  return lines.length;
}

function findSourceCommentBlock(lines: string[], start: number, end: number): string[] | null {
  for (let index = start; index < end; index++) {
    if (!isCommentLine(lines[index]!)) continue;

    if (stripCommentPrefix(lines[index]!).trim() !== "sources:") continue;

    const comments = [stripCommentPrefix(lines[index]!)];
    index++;
    while (index < end && isCommentLine(lines[index]!)) {
      comments.push(stripCommentPrefix(lines[index]!));
      index++;
    }
    index--;

    return comments;
  }
  return null;
}

function hasSourceLikeComment(lines: string[], start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (!isCommentLine(lines[index]!)) continue;
    if (/source|sources|来源|PRD|prd|reference|references/.test(stripCommentPrefix(lines[index]!))) return true;
  }
  return false;
}

function isRuleHeading(line: string): boolean {
  return ruleHeadingRe.test(line);
}

function isScenarioHeading(line: string): boolean {
  return scenarioHeadingRe.test(line);
}

function isStepLine(line: string): boolean {
  const trimmed = line.trimStart();
  return englishStepRe.test(trimmed) || chineseStepRe.test(trimmed);
}

function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

function stripCommentPrefix(line: string): string {
  return line.replace(/^\s*# ?/, "");
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

function extractMarkdownTitle(content: string): string | null {
  return content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function headingLabel(heading: Heading): string {
  if (heading.kind === "feature") return "Feature";
  return heading.kind === "rule" ? "规则" : "场景";
}
