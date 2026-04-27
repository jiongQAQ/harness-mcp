/**
 * 子进程执行器 — 跑 harness.yaml.verify.cmd
 */
import { spawn } from "node:child_process";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function runShell(
  cmd: string,
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number } = {
    cwd: process.cwd(),
  },
): Promise<RunResult> {
  const start = Date.now();
  return new Promise<RunResult>((resolve) => {
    const proc = spawn(cmd, {
      cwd: opts.cwd,
      shell: true,
      env: { ...process.env, ...(opts.env ?? {}) },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

    let timer: NodeJS.Timeout | null = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, opts.timeoutMs);
    }

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * 把 "{capability}" 占位符替换成真实值,转义双引号。
 */
export function applyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    return v === undefined ? m : v;
  });
}
