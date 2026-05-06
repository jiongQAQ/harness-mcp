#!/usr/bin/env bun
/**
 * 简易冒烟测试 — 通过 stdio 给 MCP server 发 JSON-RPC,验证实用工具集可调用
 */
import { spawn } from "node:child_process";

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: import.meta.dir + "/..",
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
    } catch {
      // ignore non-json
    }
  }
});

proc.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(`[stderr] ${chunk.toString()}`);
});

function send(req: any) {
  proc.stdin.write(JSON.stringify(req) + "\n");
}

// Step 1: initialize
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  },
});

await new Promise((r) => setTimeout(r, 500));

// Step 2: list tools
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

await new Promise((r) => setTimeout(r, 300));

// Step 3: call help as the smallest practical tool
send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "help", arguments: { topic: "overview" } },
});

await new Promise((r) => setTimeout(r, 500));

proc.kill();

console.log("\n=== Responses ===");
for (const r of responses) {
  console.log(JSON.stringify(r, null, 2));
}

const helpResp = responses.find((r) => r.id === 3);
const toolsResp = responses.find((r) => r.id === 2);
const toolNames =
  toolsResp?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];

const expectedTools = [
  "check",
  "context",
  "create_spec",
  "doctor",
  "flow",
  "help",
  "info",
  "list_capabilities",
  "ls",
  "read_spec",
  "run",
  "search",
  "update_spec",
  "verify",
];

if (toolNames.includes("ping")) {
  console.log("\n❌ FAIL: ping should not be registered");
  process.exit(1);
}

if (!String(helpResp?.result?.content?.[0]?.text ?? "").includes("harness-mcp help")) {
  console.log("\n❌ FAIL: help overview did not return manual text");
  process.exit(1);
}

for (const name of expectedTools) {
  if (!toolNames.includes(name)) {
    console.log(`\n❌ FAIL: missing tool ${name}`);
    process.exit(1);
  }
}

if (toolNames.includes("create_capability")) {
  console.log("\n❌ FAIL: create_capability should not be registered");
  process.exit(1);
}

console.log("\n✅ PASS: practical tool set is registered and help is callable");
process.exit(0);
