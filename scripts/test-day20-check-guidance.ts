#!/usr/bin/env bun
/**
 * Day 20 end-to-end test - check authoring guidance and constraint discovery.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-check-guidance-`);
const correctRoot = resolve(tmpRoot, "correct-root");

await mkdir(resolve(tmpRoot, "harness/specs/demo"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/constraints"), { recursive: true });
await mkdir(resolve(tmpRoot, "server/src"), { recursive: true });

await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness/specs
charter_dir: harness/charter
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "harness/specs/demo/create.feature"),
  `# language: zh-CN
# capability: demo.create
@demo

功能: 创建演示数据

  业务来源:
    - PRD: 用户提供的演示需求

  意图:
    - 创建一条可追踪的演示数据。

  边界:
    - 本能力只定义业务承诺。

  核心承诺:
    - 创建成功后必须返回编号。

  风险:
    - AI 可能吞掉异常。

  待确认:
    - 无

  场景: 创建成功
    假设 用户提交有效信息
    当 创建演示数据
    那么 应返回编号
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "harness/constraints/no-console.feature"),
  `# language: zh-CN
@constraint
功能: 禁止本次新增调试输出

  场景: 本次新增 TypeScript 代码不应新增 console.log
    假设 扫描本次新增的 "server/**/*.ts" 行
    当 匹配到 "console\\\\.log"
    那么 应该报错 "本次修改新增了调试输出"
    而且 修正方式为 "删除调试输出；确需日志时使用项目统一 logger"
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "harness/constraints/natural-language.feature"),
  `# language: zh-CN
@constraint
功能: 禁止自然语言不可执行约束

  场景: AI 不应随意写抽象
    假设 AI 正在编写业务代码
    那么 不得创建过早抽象
`,
  "utf-8",
);

await mkdir(resolve(correctRoot, "harness"), { recursive: true });
await cp(resolve(tmpRoot, "harness/constraints"), resolve(correctRoot, "harness/constraints"), {
  recursive: true,
});
await cp(resolve(tmpRoot, "harness/specs/demo"), resolve(correctRoot, "harness/demo"), {
  recursive: true,
});
await writeFile(
  resolve(correctRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/charter
`,
  "utf-8",
);

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HARNESS_PROJECT_ROOT: tmpRoot },
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
const parse = (id: number) => {
  try {
    return JSON.parse(text(id));
  } catch {
    return null;
  }
};

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-day20-check-guidance", version: "0" },
  },
});
await wait(400);

send({
  jsonrpc: "2.0",
  id: 100,
  method: "tools/call",
  params: { name: "check", arguments: { dryRun: true, raw: true } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 101,
  method: "tools/call",
  params: { name: "doctor", arguments: { raw: true } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 102,
  method: "tools/call",
  params: { name: "help", arguments: { topic: "check" } },
});
await wait(400);

send({
  jsonrpc: "2.0",
  id: 103,
  method: "tools/call",
  params: {
    name: "check",
    arguments: { path: correctRoot, dryRun: true, raw: true },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 104,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { path: correctRoot, raw: true },
  },
});
await wait(500);

proc.kill();
await wait(200);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const dryRun = parse(100);
console.log("=== check dryRun raw wrong spec_dir ===\n" + text(100) + "\n");
assert(dryRun?.constraint_count === 0, "check should not silently accept harness/specs as the convention");
assert(
  dryRun?.discovery_warnings?.some((warning: string) =>
    warning.includes("spec_dir: harness"),
  ),
  "check dryRun should explain that spec_dir should be harness",
);

const correctDryRun = parse(103);
console.log("=== check dryRun raw correct spec_dir ===\n" + text(103) + "\n");
assert(correctDryRun?.constraint_count === 2, "check should discover harness/constraints when spec_dir is harness");
assert(
  correctDryRun?.constraints?.some((c: any) => c.file === "harness/constraints/no-console.feature"),
  "check should list executable constraint",
);
assert(
  correctDryRun?.unsupported_steps?.some((issue: any) =>
    String(issue.step ?? "").includes("AI 正在编写业务代码"),
  ),
  "check dryRun should expose unsupported constraint steps",
);
assert(
  correctDryRun?.supported_step_examples?.some((step: string) =>
    step.includes("扫描本次新增的"),
  ),
  "check dryRun should include supported step examples",
);

const doctor = parse(101);
console.log("=== doctor raw wrong spec_dir ===\n" + text(101).slice(0, 1600) + "\n");
assert(
  doctor?.checks?.some(
    (c: any) =>
      c.id === "config.spec_dir_convention" &&
      c.level === "warn" &&
      String(c.message ?? "").includes("spec_dir: harness"),
  ),
  "doctor should warn when AI invents harness/specs",
);
assert(
  doctor?.checks?.some(
    (c: any) =>
      c.id === "constraints.discoverable" &&
      c.level === "fail" &&
      String(c.detail ?? "").includes("harness/constraints") &&
      String(c.detail ?? "").includes("harness/specs/constraints"),
  ),
  "doctor should fail when constraints are in a directory check will not scan",
);

const correctDoctor = parse(104);
console.log("=== doctor raw correct spec_dir ===\n" + text(104).slice(0, 1600) + "\n");
assert(
  correctDoctor?.checks?.some(
    (c: any) =>
      c.id === "constraints.builtin_steps" &&
      c.level === "fail" &&
      String(c.detail ?? "").includes("natural-language.feature") &&
      String(c.detail ?? "").includes("AI 正在编写业务代码"),
  ),
  "doctor should fail unsupported built-in constraint steps",
);

const help = text(102);
console.log("=== help check ===\n" + help + "\n");
assert(help.includes("内置 check 只认识这些句式"), "help(check) should list exact supported DSL");
assert(help.includes("Unsupported constraint step"), "help(check) should tell AI how failures are diagnosed");
assert(help.includes("不要写成纯自然语言规则"), "help(check) should warn against natural-language-only constraints");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 20 check guidance tests passed");
} else {
  process.exit(1);
}
