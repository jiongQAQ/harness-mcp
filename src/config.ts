/**
 * harness.yaml 加载与校验
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ReportSchema = z.object({
  format: z.enum(["cucumber-json", "surefire-xml"]),
  path: z.string(),
}).strict();

const CommandSchema = z.object({
  cmd: z.string(),
  workdir: z.string().optional().default("."),
  report: ReportSchema.optional(),
  timeout_ms: z.number().optional().default(300_000),
}).strict();

const BddSchema = z.object({
  runner: z.enum([
    "cucumber-js",
    "cucumber-jvm",
    "behave",
    "pytest-bdd",
    "godog",
    "custom",
  ]),
  cmd: z.string(),
  workdir: z.string().optional().default("."),
  feature_arg_pattern: z.string().optional().default("{feature}"),
  name_filter_pattern: z.string().optional(),
  report: ReportSchema,
  timeout_ms: z.number().optional().default(300_000),
}).strict();

const CommandsSchema = z.object({
  check: CommandSchema.optional(),
  lint: CommandSchema.optional(),
}).strict();

const LanguageSchema = z.enum(["zh-CN", "en"]);

export const ConfigSchema = z.object({
  version: z.literal(1),
  spec_dir: z.string().default("harness"),
  charter_dir: z.string().optional(),
  language: LanguageSchema.optional().default("zh-CN"),
  bdd: BddSchema.optional(),
  commands: CommandsSchema.optional(),
  ai_hints: z.string().optional(),
}).strict();

export type HarnessConfig = z.infer<typeof ConfigSchema>;

export const HARNESS_CONFIG_EXAMPLE = `version: 1
spec_dir: harness
charter_dir: harness/_charter
language: zh-CN

bdd:
  runner: custom
  cmd: "your-bdd-command {feature}"
  workdir: "."
  feature_arg_pattern: "{feature}"
  report:
    format: cucumber-json
    path: target/cucumber.json

commands:
  lint:
    cmd: "your-lint-command"
    workdir: "."
`;

export const HARNESS_CONFIG_SCHEMA_HELP = [
  "正确格式:",
  "```yaml",
  HARNESS_CONFIG_EXAMPLE.trimEnd(),
  "```",
  "",
  "正确顶层字段:",
  "  - version",
  "  - spec_dir",
  "  - charter_dir",
  "  - language",
  "  - bdd",
  "  - commands",
  "  - ai_hints",
  "",
  "说明:",
  "  - 将 your-bdd-command 和 your-lint-command 替换为宿主项目真实命令",
  "  - language 可选 zh-CN 或 en;缺省为 zh-CN",
  "",
  "Next action:",
  "  1. 修正 harness.yaml",
  "  2. 重新调用 project_context() 或 check() 验证配置",
].join("\n");

export interface LoadedConfig {
  /** 项目根的绝对路径 */
  projectRoot: string;
  /** harness.yaml 的绝对路径 */
  configPath: string;
  /** 解析后的配置 */
  config: HarnessConfig;
  /** spec_dir 的绝对路径 */
  specDirAbs: string;
  /** charter_dir 的绝对路径(若未配置则 specDirAbs/_charter) */
  charterDirAbs: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function formatMissingHarnessConfig(projectRoot: string): string {
  return [
    `No harness.yaml found at ${projectRoot}.`,
    "",
    HARNESS_CONFIG_SCHEMA_HELP,
  ].join("\n");
}

/**
 * 从 projectRoot 加载 harness.yaml。
 * 文件不存在返回 null(调用方决定是报错还是降级)。
 */
export async function loadConfig(
  projectRoot: string,
): Promise<LoadedConfig | null> {
  const root = isAbsolute(projectRoot)
    ? projectRoot
    : resolve(process.cwd(), projectRoot);

  const configPath = resolve(root, "harness.yaml");
  if (!existsSync(configPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (e) {
    throw new ConfigError(`无法读取 ${configPath}: ${(e as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new ConfigError(formatHarnessConfigError(`YAML 解析失败: ${(e as Error).message}`));
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      formatHarnessConfigError(result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")),
    );
  }

  const config = result.data;
  const specDirAbs = resolve(root, config.spec_dir);
  const charterDirAbs = config.charter_dir
    ? resolve(root, config.charter_dir)
    : resolve(specDirAbs, "_charter");

  return {
    projectRoot: root,
    configPath,
    config,
    specDirAbs,
    charterDirAbs,
  };
}

function formatHarnessConfigError(error: string): string {
  return [
    "harness.yaml 配置不合法:",
    `  - ${error}`,
    "",
    HARNESS_CONFIG_SCHEMA_HELP,
  ].join("\n");
}
