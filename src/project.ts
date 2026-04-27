/**
 * 工具共享:确定 projectRoot
 *
 * 优先级:
 *   1. 工具入参 path
 *   2. 环境变量 HARNESS_PROJECT_ROOT
 *   3. process.cwd()
 */
import { isAbsolute, resolve } from "node:path";

export function resolveProjectRoot(input?: string): string {
  const candidate =
    input?.trim() || process.env["HARNESS_PROJECT_ROOT"] || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}
