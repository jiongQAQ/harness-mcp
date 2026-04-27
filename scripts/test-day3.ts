#!/usr/bin/env bun
/**
 * Day 3 端到端测试 — 通过 MCP 协议调 context / list_capabilities
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const fixtureRoot = resolve(import.meta.dir, "../examples/sel-service-yaml");

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: resolve(import.meta.dir, ".."),
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HARNESS_PROJECT_ROOT: fixtureRoot },
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

const send = (req: any) =>
  proc.stdin.write(JSON.stringify(req) + "\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "context", arguments: {} },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "list_capabilities", arguments: { tag: "subject-literacy" } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: { name: "context", arguments: { raw: true } },
});
await wait(500);

proc.kill();
await wait(200);

let allPass = true;

const tools = responses.find((r) => r.id === 2);
const toolNames = (tools?.result?.tools ?? []).map((t: any) => t.name);
console.log("Tools registered:", toolNames);
if (!["ping", "context", "list_capabilities"].every((n) => toolNames.includes(n))) {
  console.error("❌ FAIL: missing tools");
  allPass = false;
}

const ctxResp = responses.find((r) => r.id === 3);
const ctxText = ctxResp?.result?.content?.[0]?.text ?? "";
console.log("\n=== context (formatted) ===\n" + ctxText);
if (!ctxText.includes("项目分层约定")) {
  console.error("❌ FAIL: charter content missing");
  allPass = false;
}
if (!ctxText.includes("subject-literacy.getByUid")) {
  console.error("❌ FAIL: capability missing");
  allPass = false;
}

const lcResp = responses.find((r) => r.id === 4);
const lcText = lcResp?.result?.content?.[0]?.text ?? "";
console.log("\n=== list_capabilities tag=subject-literacy ===\n" + lcText);
if (!lcText.includes("2 capabilities")) {
  console.error(`❌ FAIL: expect 2, got: ${lcText.slice(0, 80)}`);
  allPass = false;
}

const rawResp = responses.find((r) => r.id === 5);
const rawText = rawResp?.result?.content?.[0]?.text ?? "";
let rawObj: any;
try {
  rawObj = JSON.parse(rawText);
} catch {
  console.error("❌ FAIL: raw output not valid JSON");
  allPass = false;
}
if (rawObj && rawObj.capabilities?.length !== 2) {
  console.error("❌ FAIL: raw caps != 2");
  allPass = false;
}

if (allPass) {
  console.log("\n✅ All Day 3 tests passed");
} else {
  process.exit(1);
}
