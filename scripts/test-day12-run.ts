#!/usr/bin/env bun
/**
 * Day 12 end-to-end test — run tool.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-run-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });
await mkdir(resolve(tmpRoot, "target"), { recursive: true });

const runYaml = `version: 1
spec_dir: harness
charter_dir: harness/_charter

commands:
  run:
    cmd: 'cp "$REPORT_SRC" target/run-cucumber.json && echo "run all"'
    workdir: "."
    report:
      format: cucumber-json
      path: target/run-cucumber.json
    timeout_ms: 10000

ai_hints: ""
`;
await writeFile(resolve(tmpRoot, "harness.yaml"), runYaml, "utf-8");

const report = JSON.stringify([
  {
    uri: "harness/ai-learning/subject-literacy/getByUid.feature",
    name: "按知识图谱节点UID查询学科素养",
    elements: [
      {
        type: "scenario",
        name: "uid 下挂多条 — 全部返回",
        line: 17,
        steps: [{ name: "断言", result: { status: "passed" } }],
      },
      {
        type: "scenario",
        name: "uid 下无记录 — 空列表",
        line: 25,
        steps: [
          { name: "调用", result: { status: "passed" } },
          {
            name: "断言返回空列表",
            result: {
              status: "failed",
              error_message: "Expected [], got null\n at run.feature:25",
            },
          },
        ],
      },
    ],
  },
]);
const reportSrc = resolve(tmpRoot, "_run-report.json");
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
    clientInfo: { name: "test-day12-run", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 80,
  method: "tools/call",
  params: { name: "run", arguments: {} },
});
await wait(1000);

send({
  jsonrpc: "2.0",
  id: 81,
  method: "tools/call",
  params: { name: "run", arguments: { raw: true } },
});
await wait(1000);

proc.kill();
await wait(200);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`❌ FAIL: ${message}`);
    pass = false;
  }
};

const tools = responses.find((r) => r.id === 2);
const toolNames = (tools?.result?.tools ?? []).map((t: any) => t.name);
console.log("Tools registered:", toolNames);
assert(toolNames.includes("run"), "run tool is not registered");

const formatted = text(80);
console.log("\n=== run formatted ===\n" + formatted + "\n");
assert(formatted.includes("$ cp \"$REPORT_SRC\""), "formatted output missing command");
assert(formatted.includes("Test Summary"), "formatted output missing test summary");
assert(formatted.includes("passed=1"), "formatted output missing passed count");
assert(formatted.includes("failed=1"), "formatted output missing failed count");
assert(formatted.includes("Expected [], got null"), "formatted output missing failure error");

const rawText = text(81);
let raw: any;
try {
  raw = JSON.parse(rawText);
} catch {
  raw = null;
}
console.log("=== run raw ===\n" + rawText.slice(0, 1000) + "\n");
assert(raw?.command_type === "run", "raw command_type should be run");
assert(raw?.exit_code === 0, "raw exit_code should be 0");
assert(raw?.report?.summary?.total === 2, "raw summary total should be 2");
assert(raw?.report?.failures?.length === 1, "raw should include one failure");
assert(raw?.report_path?.endsWith("target/run-cucumber.json"), "raw report_path malformed");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\n✅ All Day 12 run tests passed");
} else {
  process.exit(1);
}
