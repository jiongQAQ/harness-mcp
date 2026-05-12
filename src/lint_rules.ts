/**
 * Project-owned code quality rules for lint().
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const LintRuleEntrySchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1),
  flags: z.string().regex(/^[dgimsuvy]*$/).optional().default(""),
  message: z.string().min(1),
  fix: z.string().min(1),
}).strict();

const LintRulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(LintRuleEntrySchema).default([]),
}).strict();

export type LintRuleEntry = z.infer<typeof LintRuleEntrySchema>;

export const LINT_RULES_EXAMPLE = `version: 1
rules:
  - id: <rule-id>
    pattern: "<line-level JavaScript regex>"
    message: "<命中时的错误说明>"
    fix: "<建议修正方式>"
`;

export const LINT_RULES_SCHEMA_HELP = [
  "正确位置:",
  "  - .harness/lint/rules.yaml",
  "",
  "正确格式:",
  "```yaml",
  LINT_RULES_EXAMPLE.trimEnd(),
  "```",
  "",
  "说明:",
  "  - rules 缺省或文件不存在时,不执行自定义代码规则",
  "  - pattern 是逐行匹配的 JavaScript 正则",
  "  - 跨行或语义级规则应放到宿主项目 lint/checkstyle/PMD/ESLint,再通过 commands.lint 接入",
  "",
  "Next action:",
  "  1. 修正 .harness/lint/rules.yaml",
  "  2. 重新调用 lint() 验证",
].join("\n");

export type LintRulesLoad =
  | { path: string; exists: false; ok: true; rules: LintRuleEntry[] }
  | { path: string; exists: true; ok: true; rules: LintRuleEntry[] }
  | { path: string; exists: true; ok: false; error: string };

export function lintRulesPath(specDirAbs: string): string {
  return resolve(specDirAbs, "lint/rules.yaml");
}

export async function loadLintRules(specDirAbs: string): Promise<LintRulesLoad> {
  const path = lintRulesPath(specDirAbs);
  if (!existsSync(path)) return { path, exists: false, ok: true, rules: [] };

  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch (error) {
    return {
      path,
      exists: true,
      ok: false,
      error: formatLintRulesError(`无法读取文件: ${(error as Error).message}`),
    };
  }

  const parsed = parseLintRulesContent(content);
  if (!parsed.ok) return { path, exists: true, ok: false, error: parsed.error };
  return { path, exists: true, ok: true, rules: parsed.rules };
}

export function parseLintRulesContent(
  content: string,
): { ok: true; rules: LintRuleEntry[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    return { ok: false, error: formatLintRulesError(`YAML 解析失败: ${(error as Error).message}`) };
  }

  const result = LintRulesFileSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: formatLintRulesError(formatZodIssues(result.error.issues)) };
  }

  for (const rule of result.data.rules) {
    try {
      new RegExp(rule.pattern, rule.flags);
    } catch (error) {
      return {
        ok: false,
        error: formatLintRulesError(`rules.${rule.id}.pattern 正则不合法: ${(error as Error).message}`),
      };
    }
  }

  return { ok: true, rules: result.data.rules };
}

export function formatLintRulesError(error: string): string {
  return [
    ".harness/lint/rules.yaml 格式错误:",
    `  - ${error}`,
    "",
    LINT_RULES_SCHEMA_HELP,
  ].join("\n");
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
