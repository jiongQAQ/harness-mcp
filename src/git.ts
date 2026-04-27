/**
 * git diff HEAD — 捕获未提交的改动,带文件级 cap。
 */
import { runShell } from "./runner.ts";

export interface GitDiffResult {
  isGitRepo: boolean;
  diff: string;
  truncated: boolean;
}

const MAX_DIFF_BYTES = 64 * 1024; // 64 KB,防止把 verify 返回撑爆

export async function captureGitDiff(cwd: string): Promise<GitDiffResult> {
  // 先确认是 git 仓库
  const check = await runShell("git rev-parse --is-inside-work-tree", {
    cwd,
    timeoutMs: 5_000,
  });
  if (check.exitCode !== 0) {
    return { isGitRepo: false, diff: "", truncated: false };
  }

  // 拿 staged + unstaged
  const r = await runShell("git diff HEAD --no-color", {
    cwd,
    timeoutMs: 15_000,
  });

  let diff = r.stdout;
  let truncated = false;
  if (diff.length > MAX_DIFF_BYTES) {
    diff = diff.slice(0, MAX_DIFF_BYTES);
    truncated = true;
  }
  return { isGitRepo: true, diff, truncated };
}
