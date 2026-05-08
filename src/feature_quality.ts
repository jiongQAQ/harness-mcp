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
  "待确认",
] as const;

const SECTION_RE = /^\s*(业务来源|意图|边界|核心承诺|风险|待确认)\s*[：:]\s*$/;
const SCENARIO_RE = /^\s*(?:Scenario|场景|場景|Escenario):\s*.+$/gm;
const RULE_RE = /^\s*(?:Rule|规则|規則):\s*.+$/gm;
const ENTRYPOINT_RE = /^#\s*entrypoint:\s*(.+)\s*$/m;
const THEN_RE = /^\s*(?:Then|And|But|那么|而且|并且|但是)\s+(.+)$/gm;
const SOURCE_KEYWORDS = ["PRD", "用户提供", "人工确认", "代码推断", "现有测试"];
const CODE_MODULE_SEGMENT_RE = /\b[A-Z][A-Za-z0-9]*(?:Controller|Service|Handler|Impl)\b/;
const ZH_CN_LANGUAGE_RE = /^\s*#\s*language:\s*zh-CN\s*$/m;
const GENERIC_THEN_RE =
  /(?:应|应该)?(?:返回|响应|请求|接口|调用).{0,8}(?:成功|完整内容|完整的.*内容|200|ok)|状态码.{0,4}200/i;

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

  if (!content.match(ENTRYPOINT_RE)?.[1]?.trim()) {
    issues.push({
      id: "feature_quality.entrypoint",
      level: "fail",
      message: "缺少 # entrypoint: <业务入口方法或 planned:业务入口>",
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

  if (![...content.matchAll(RULE_RE)].length) {
    issues.push({
      id: "feature_quality.rules",
      level: "fail",
      message: "缺少 Rule/规则 分组;请先写业务规则,再写场景例子",
      detail: fileRel || undefined,
    });
  }

  const genericThen = [...content.matchAll(THEN_RE)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((step) => GENERIC_THEN_RE.test(step));
  if (genericThen.length > 0) {
    issues.push({
      id: "feature_quality.then_specificity",
      level: "fail",
      message: `Then 过于空泛: ${genericThen.join("; ")}`,
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
