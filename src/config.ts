/**
 * harness.yaml 加载与校验
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ReportSchema = z.object({
  format: z.enum(["cucumber-json", "surefire-xml", "pytest-json"]),
  path: z.string(),
});

const VerifySchema = z.object({
  cmd: z.string(),
  workdir: z.string().optional().default("."),
  filter_pattern: z.string().optional(),
  report: ReportSchema.optional(),
  timeout_ms: z.number().optional().default(300_000),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
  spec_dir: z.string().default("harness"),
  charter_dir: z.string().optional(),
  verify: VerifySchema.optional(),
  ai_hints: z.string().optional(),
});

export type HarnessConfig = z.infer<typeof ConfigSchema>;

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
    throw new ConfigError(`harness.yaml YAML 解析失败: ${(e as Error).message}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      `harness.yaml 配置不合法:\n${result.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
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
