#!/usr/bin/env bun
/**
 * Day 17 end-to-end test - check built-in constraints against git diff lines.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-check-diff-`);

const git = (...args: string[]) => {
  const result = spawnSync("git", args, {
    cwd: tmpRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
};

await mkdir(resolve(tmpRoot, "harness/constraints"), { recursive: true });
await mkdir(resolve(tmpRoot, "src/main/java/com/example"), { recursive: true });

await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
ai_hints: ""
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "harness/constraints/no-diff-bad-style.feature"),
  `# language: zh-CN
@constraint
功能: 本次修改不允许新增低质量代码

  场景: 本次 Java 修改不应新增 catch Exception 或 Throwable
    假设 扫描本次新增的 "src/**/*.java" 行
    当 匹配到 "catch\\s*\\(\\s*(Exception|Throwable)\\b"
    那么 应该报错 "本次修改新增了宽泛 catch"
    而且 修正方式为 "捕获明确异常；确需兜底时写明原因并转换或重新抛出"

  场景: 本次 Java 修改不应新增临时输出
    假设 扫描本次新增的 "src/**/*.java" 行
    当 匹配到 "System\\.out\\.println|printStackTrace\\(\\)"
    那么 应该报错 "本次修改新增了临时输出或堆栈打印"
    而且 修正方式为 "使用项目日志规范,或删除临时调试代码"
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "src/main/java/com/example/LegacyService.java"),
  `package com.example;

class LegacyService {
  void oldRun() {
    try {
      risky();
    } catch (Exception e) {
      // historical issue, should not fail diff-aware check
    }
  }

  void risky() throws Exception {}
}
`,
  "utf-8",
);

git("init");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Harness MCP Test");
git("add", ".");
git("commit", "-m", "baseline");

await writeFile(
  resolve(tmpRoot, "src/main/java/com/example/NewService.java"),
  `package com.example;

class NewService {
  void run() {
    try {
      risky();
    } catch (Exception e) {
      System.out.println("debug");
      // newly added by AI
    }
  }

  void risky() throws Exception {}
}
`,
  "utf-8",
);

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_PROJECT_ROOT: tmpRoot,
  },
});

let buf = "";
const responses: any[] = [];
proc.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      responses.push(JSON.parse(line));
    } catch {}
  }
});
proc.stderr.on("data", (c: Buffer) => process.stderr.write(`[err] ${c}`));

const send = (req: any) => proc.stdin.write(JSON.stringify(req) + "\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (id: number) =>
  responses.find((r) => r.id === id)?.result?.content?.[0]?.text ?? "";

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-day17-check-diff-lint", version: "0" },
  },
});
await wait(400);

send({
  jsonrpc: "2.0",
  id: 100,
  method: "tools/call",
  params: { name: "check", arguments: { raw: true } },
});
await wait(1000);

proc.kill();
await wait(200);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const rawText = text(100);
let raw: any;
try {
  raw = JSON.parse(rawText);
} catch {
  raw = null;
}

console.log("=== check diff-aware raw ===\n" + rawText + "\n");
const error = (raw?.report?.failures ?? [])
  .map((failure: any) => failure.errorMessage ?? "")
  .join("\n");
assert(raw?.runner === "builtin", "check should use built-in runner");
assert(raw?.exit_code === 1, "diff-aware check should fail on newly added broad catch");
assert(raw?.report?.summary?.failed === 2, "diff-aware check should fail both generic rules");
assert(error.includes("本次修改新增了宽泛 catch"), "failure should include custom message");
assert(
  error.includes("src/main/java/com/example/NewService.java:7"),
  "failure should include new file and line",
);
assert(error.includes("catch (Exception e)"), "failure should include offending added line");
assert(error.includes("本次修改新增了临时输出或堆栈打印"), "failure should include style rule message");
assert(
  error.includes("src/main/java/com/example/NewService.java:8"),
  "failure should include second style violation line",
);
assert(error.includes("System.out.println"), "failure should include generic style match");
assert(!error.includes("LegacyService.java"), "failure should not include committed legacy code");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 17 diff-aware check tests passed");
} else {
  process.exit(1);
}
