#!/usr/bin/env bun
/**
 * Day 16 end-to-end test - check built-in generic lint constraints.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-check-builtin-`);

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
  resolve(tmpRoot, "harness/constraints/no-broad-catch.feature"),
  `# language: zh-CN
@constraint
功能: 不允许宽泛兜底异常

  场景: Java 源码不应 catch Exception 或 Throwable
    假设 扫描 "src/**/*.java"
    当 匹配到 "catch\\s*\\(\\s*(Exception|Throwable)\\b"
    那么 应该报错 "不要随意兜底捕获 Exception 或 Throwable"
    而且 修正方式为 "捕获明确异常；确需边界兜底时要记录上下文并重新抛出或转换为业务异常"
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "src/main/java/com/example/BadService.java"),
  `package com.example;

class BadService {
  void run() {
    try {
      risky();
    } catch (Exception e) {
      // swallowed
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
    clientInfo: { name: "test-day16-check-builtin-lint", version: "0" },
  },
});
await wait(400);

send({
  jsonrpc: "2.0",
  id: 100,
  method: "tools/call",
  params: { name: "check", arguments: { raw: true } },
});
await wait(800);

send({
  jsonrpc: "2.0",
  id: 101,
  method: "tools/call",
  params: { name: "check", arguments: {} },
});
await wait(800);

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

console.log("=== check built-in raw ===\n" + rawText + "\n");
assert(raw?.command_type === "check", "raw command_type should be check");
assert(raw?.runner === "builtin", "check should use built-in runner without commands.check");
assert(raw?.exit_code === 1, "built-in check should fail on broad catch");
assert(raw?.report?.summary?.total === 1, "summary total should be 1");
assert(raw?.report?.summary?.failed === 1, "summary failed should be 1");
assert(raw?.report?.failures?.[0]?.errorMessage?.includes("不要随意兜底捕获"), "failure should include custom message");
assert(
  raw?.report?.failures?.[0]?.errorMessage?.includes("src/main/java/com/example/BadService.java:7"),
  "failure should include matched file and line",
);

const formatted = text(101);
console.log("=== check built-in formatted ===\n" + formatted + "\n");
assert(formatted.includes("Built-in constraints"), "formatted should mention built-in constraints");
assert(formatted.includes("failed=1"), "formatted should show failed count");
assert(formatted.includes("catch (Exception e)"), "formatted should include offending source line");
assert(formatted.includes("捕获明确异常"), "formatted should include fix hint");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 16 built-in check tests passed");
} else {
  process.exit(1);
}
