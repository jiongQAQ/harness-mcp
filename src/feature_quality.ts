/**
 * Feature quality gate — validates that a .feature is a business contract,
 * not only a syntactically valid Gherkin file.
 */

export type FeatureQualityLevel = "fail" | "warn";

export interface FeatureQualityIssue {
  id: string;
  level: FeatureQualityLevel;
  message: string;
  detail?: string;
}

export interface FeatureQualityResult {
  ok: boolean;
  issues: FeatureQualityIssue[];
  failures: FeatureQualityIssue[];
  warnings: FeatureQualityIssue[];
}

const REQUIRED_SECTIONS = [
  "业务来源",
  "意图",
  "边界",
  "核心承诺",
  "风险",
  "待确认",
] as const;

const SECTION_RE = /^\s*(业务来源|意图|边界|核心承诺|风险|待确认)\s*[：:]\s*$/;
const SCENARIO_RE = /^\s*(?:Scenario|场景|場景|Escenario):\s*.+$/gm;
const SOURCE_KEYWORDS = ["PRD", "用户提供", "人工确认", "代码推断", "现有测试"];
const CODE_MODULE_SEGMENT_RE = /\b[A-Z][A-Za-z0-9]*(?:Controller|Service|Handler|Impl)\b/;
const ZH_CN_LANGUAGE_RE = /^\s*#\s*language:\s*zh-CN\s*$/m;

export function hasZhCnLanguageHeader(content: string): boolean {
  return ZH_CN_LANGUAGE_RE.test(content);
}

export function checkFeatureQuality(
  content: string,
  fileRel = "",
): FeatureQualityResult {
  const sections = extractSections(content);
  const issues: FeatureQualityIssue[] = [];

  if (!hasZhCnLanguageHeader(content)) {
    issues.push({
      id: "feature_quality.language",
      level: "fail",
      message: "harness feature 默认使用中文,请在文件头加入 # language: zh-CN",
      detail: fileRel || undefined,
    });
  }

  for (const section of REQUIRED_SECTIONS) {
    const body = sections.get(section);
    if (!body || body.length === 0) {
      issues.push({
        id: "feature_quality.required_sections",
        level: "fail",
        message: `缺少业务契约段落: ${section}`,
        detail: fileRel || undefined,
      });
    }
  }

  const sourceBody = sections.get("业务来源")?.join("\n") ?? "";
  if (sourceBody && !SOURCE_KEYWORDS.some((keyword) => sourceBody.includes(keyword))) {
    issues.push({
      id: "feature_quality.business_source",
      level: "fail",
      message: "业务来源必须标明来源类型: PRD / 用户提供 / 人工确认 / 代码推断 / 现有测试",
      detail: fileRel || undefined,
    });
  }

  if (![...content.matchAll(SCENARIO_RE)].length) {
    issues.push({
      id: "feature_quality.scenarios",
      level: "fail",
      message: "feature 至少需要一个场景作为关键验证示例",
      detail: fileRel || undefined,
    });
  }

  if (fileRel && looksLikeCodeModulePath(fileRel)) {
    issues.push({
      id: "feature_quality.path_style",
      level: "warn",
      message: "feature 路径疑似按代码模块命名,建议按业务能力组织",
      detail: fileRel,
    });
  }

  const failures = issues.filter((issue) => issue.level === "fail");
  const warnings = issues.filter((issue) => issue.level === "warn");
  return {
    ok: failures.length === 0,
    issues,
    failures,
    warnings,
  };
}

export function formatFeatureQualityFailure(
  result: FeatureQualityResult,
  fileRel: string,
): string {
  return [
    `Feature 质量检查失败: ${fileRel}`,
    ...result.failures.map((issue) => `  - ${issue.message}`),
  ].join("\n");
}

function extractSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(SECTION_RE)?.[1] ?? null;
    if (heading) {
      current = heading;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }

    if (!current) continue;
    if (/^\s*(?:Scenario|场景|場景|Escenario):/.test(line)) {
      current = null;
      continue;
    }
    if (/^\s*(?:Feature|功能|機能|Característica):/.test(line)) {
      current = null;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    sections.get(current)!.push(trimmed);
  }

  return sections;
}

function looksLikeCodeModulePath(fileRel: string): boolean {
  return fileRel
    .split("/")
    .some((segment) => CODE_MODULE_SEGMENT_RE.test(segment.replace(/\.feature$/, "")));
}
