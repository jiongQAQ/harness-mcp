/**
 * 工具共享:确定 projectRoot
 *
 * 优先级:
 *   1. 工具入参 path
 *   2. 从当前工作目录向上查找 harness.yaml
 *   3. 从当前工作目录向上查找 .git
 *   4. 环境变量 HARNESS_PROJECT_ROOT
 *   5. process.cwd()
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export function resolveProjectRoot(input?: string): string {
  const explicit = input?.trim();
  if (explicit) {
    return toAbsolute(explicit);
  }

  const cwd = process.cwd();
  const harnessRoot = findUp(cwd, "harness.yaml");
  if (harnessRoot) return harnessRoot;

  const gitRoot = findUp(cwd, ".git");
  if (gitRoot) return gitRoot;

  const envRoot = process.env["HARNESS_PROJECT_ROOT"];
  if (envRoot) return toAbsolute(envRoot);

  return cwd;
}

function toAbsolute(candidate: string): string {
  return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function findUp(start: string, marker: string): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(resolve(dir, marker))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
