#!/usr/bin/env bun
/**
 * Day 19 end-to-end test - help tool and Chinese defaults.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
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
    clientInfo: { name: "test-day19-help", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 90,
  method: "tools/call",
  params: { name: "help", arguments: {} },
});
await wait(300);

send({
  jsonrpc: "2.0",
  id: 91,
  method: "tools/call",
  params: { name: "help", arguments: { topic: "feature" } },
});
await wait(300);

send({
  jsonrpc: "2.0",
  id: 92,
  method: "tools/call",
  params: { name: "help", arguments: { topic: "check" } },
});
await wait(300);

send({
  jsonrpc: "2.0",
  id: 93,
  method: "tools/call",
  params: { name: "help", arguments: { topic: "create_spec" } },
});
await wait(300);

send({
  jsonrpc: "2.0",
  id: 94,
  method: "tools/call",
  params: { name: "help", arguments: { raw: true } },
});
await wait(300);

send({
  jsonrpc: "2.0",
  id: 95,
  method: "tools/call",
  params: { name: "help", arguments: { topic: "no-such-topic" } },
});
await wait(300);

proc.kill();
await wait(200);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const toolsResp = responses.find((r) => r.id === 2);
const toolNames =
  toolsResp?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
console.log("Tools registered:", toolNames);
assert(toolNames.includes("help"), "help tool should be registered");

const overview = text(90);
console.log("\n=== help overview ===\n" + overview + "\n");
assert(overview.includes("默认使用中文"), "overview should explain Chinese default");
assert(overview.includes("help 不读取当前项目"), "overview should state help is static MCP usage guidance");
assert(overview.includes("了解当前项目请用 context/info/doctor"), "overview should route project understanding to context/info/doctor");
assert(overview.includes("MCP 工具清单"), "overview should primarily list MCP tools");
assert(overview.includes("用户说 harness help"), "overview should handle explicit harness help requests");
assert(overview.includes("info"), "overview should mention info");
assert(overview.includes("doctor"), "overview should mention doctor");
assert(overview.includes("context"), "overview should mention context");
assert(overview.includes("create_spec"), "overview should mention create_spec");
assert(overview.includes("verify"), "overview should mention verify");
assert(overview.includes("check"), "overview should mention check");

const featureHelp = text(91);
console.log("=== help feature ===\n" + featureHelp + "\n");
assert(featureHelp.includes("# language: zh-CN"), "feature help should include zh-CN header");
assert(featureHelp.includes("功能:"), "feature help should use Chinese Gherkin");
assert(featureHelp.includes("场景:"), "feature help should include Chinese scenario");
assert(featureHelp.includes("业务来源"), "feature help should include business source section");

const checkHelp = text(92);
console.log("=== help check ===\n" + checkHelp + "\n");
assert(checkHelp.includes("git diff"), "check help should explain diff-aware checking");
assert(checkHelp.includes("扫描本次新增"), "check help should include built-in scan phrase");
assert(checkHelp.includes("修正方式"), "check help should include remediation guidance");

const createSpecHelp = text(93);
console.log("=== help create_spec ===\n" + createSpecHelp + "\n");
assert(createSpecHelp.includes("create_spec"), "tool help should name the tool");
assert(createSpecHelp.includes("# capability"), "create_spec help should mention capability metadata");
assert(createSpecHelp.includes("# language: zh-CN"), "create_spec help should mention Chinese header");

const raw = parse(94);
console.log("=== help raw ===\n" + text(94).slice(0, 1000) + "\n");
assert(raw?.default_language === "zh-CN", "raw help should expose default language");
assert(raw?.tools?.some((tool: any) => tool.name === "help"), "raw help should list help");
assert(raw?.tools?.some((tool: any) => tool.name === "verify"), "raw help should list verify");
assert(raw?.topics?.includes("feature"), "raw help should list feature topic");
assert(raw?.topics?.includes("check"), "raw help should list check topic");

const unknown = text(95);
console.log("=== help unknown ===\n" + unknown + "\n");
assert(unknown.includes("未知 help topic"), "unknown topic should be explicit");
assert(unknown.includes("可用 topic"), "unknown topic should list alternatives");

if (pass) {
  console.log("\nAll Day 19 help tests passed");
} else {
  process.exit(1);
}
