#!/usr/bin/env bun
/**
 * Day 14 end-to-end test - check tool.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-check-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });
await mkdir(resolve(tmpRoot, "harness/constraints"), { recursive: true });
await mkdir(resolve(tmpRoot, "target"), { recursive: true });

await writeFile(
  resolve(tmpRoot, "harness/constraints/package-structure.feature"),
  `# language: zh-CN
@constraint @architecture
功能: 包结构约束

  场景: 接口层不能依赖基础设施层
    那么 api.service.impl 不直接依赖 infrastructure
`,
  "utf-8",
);

const checkYaml = `version: 1
spec_dir: harness
charter_dir: harness/_charter

commands:
  run:
    cmd: 'echo "run should not execute from check" && exit 42'
    workdir: "."
  check:
    cmd: 'cp "$REPORT_SRC" target/check-cucumber.json && echo "check all"'
    workdir: "."
    report:
      format: cucumber-json
      path: target/check-cucumber.json
    timeout_ms: 10000

ai_hints: ""
`;
await writeFile(resolve(tmpRoot, "harness.yaml"), checkYaml, "utf-8");

const report = JSON.stringify([
  {
    uri: "harness/constraints/package-structure.feature",
    name: "包结构约束",
    elements: [
      {
        type: "scenario",
        name: "接口层不能依赖基础设施层",
        line: 5,
        steps: [
          {
            name: "api.service.impl 不直接依赖 infrastructure",
            result: {
              status: "failed",
              error_message: "Found illegal dependency api -> infrastructure",
            },
          },
        ],
      },
      {
        type: "scenario",
        name: "领域层保持纯净",
        line: 9,
        steps: [{ name: "domain has no web dependency", result: { status: "passed" } }],
      },
    ],
  },
]);
const reportSrc = resolve(tmpRoot, "_check-report.json");
await writeFile(reportSrc, report, "utf-8");

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_PROJECT_ROOT: tmpRoot,
    REPORT_SRC: reportSrc,
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
    clientInfo: { name: "test-day14-check", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

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
  params: { name: "check", arguments: {} },
});
await wait(1000);

send({
  jsonrpc: "2.0",
  id: 102,
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

const tools = responses.find((r) => r.id === 2);
const toolNames = (tools?.result?.tools ?? []).map((t: any) => t.name);
console.log("Tools registered:", toolNames);
assert(toolNames.includes("check"), "check tool is not registered");

const dryRunText = text(100);
let dryRun: any;
try {
  dryRun = JSON.parse(dryRunText);
} catch {
  dryRun = null;
}
console.log("\n=== check dryRun raw ===\n" + dryRunText + "\n");
assert(dryRun?.command_type === "check", "dryRun command_type should be check");
assert(dryRun?.dry_run === true, "dryRun flag should be true");
assert(dryRun?.constraint_count === 1, "dryRun should list one constraint");
assert(
  dryRun?.constraints?.[0]?.file === "harness/constraints/package-structure.feature",
  "dryRun should include constraint file",
);
assert(dryRun?.exit_code === null, "dryRun should not execute command");

const formatted = text(101);
console.log("=== check formatted ===\n" + formatted + "\n");
assert(formatted.includes("$ cp \"$REPORT_SRC\""), "formatted missing check command");
assert(formatted.includes("Test Summary"), "formatted missing test summary");
assert(formatted.includes("passed=1"), "formatted missing passed count");
assert(formatted.includes("failed=1"), "formatted missing failed count");
assert(
  formatted.includes("Found illegal dependency api -> infrastructure"),
  "formatted missing failure error",
);
assert(!formatted.includes("run should not execute"), "check should not execute run");

const rawText = text(102);
let raw: any;
try {
  raw = JSON.parse(rawText);
} catch {
  raw = null;
}
console.log("=== check raw ===\n" + rawText.slice(0, 1000) + "\n");
assert(raw?.command_type === "check", "raw command_type should be check");
assert(raw?.exit_code === 0, "raw exit_code should be 0");
assert(raw?.report?.summary?.total === 2, "raw summary total should be 2");
assert(raw?.report?.failures?.length === 1, "raw should include one failure");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 14 check tests passed");
} else {
  process.exit(1);
}
