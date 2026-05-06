#!/usr/bin/env bun
/**
 * Day 8 end-to-end test — info tool.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const fixtureRoot = resolve(import.meta.dir, "../examples/sel-service-yaml");
const noConfigRoot = await mkdtemp(`${tmpdir()}/harness-mcp-info-empty-`);

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
    clientInfo: { name: "test-day8-info", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 50,
  method: "tools/call",
  params: { name: "info", arguments: {} },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 51,
  method: "tools/call",
  params: { name: "info", arguments: { raw: true } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 52,
  method: "tools/call",
  params: { name: "info", arguments: { raw: true, path: noConfigRoot } },
});
await wait(500);

proc.kill();
await wait(200);

let pass = true;

const tools = responses.find((r) => r.id === 2);
const toolNames = (tools?.result?.tools ?? []).map((t: any) => t.name);
console.log("Tools registered:", toolNames);
if (!toolNames.includes("info")) {
  console.error("❌ FAIL: info tool is not registered");
  pass = false;
}

const formatted = text(50);
console.log("\n=== info formatted ===\n" + formatted + "\n");
for (const expected of [
  "Project:",
  "harness.yaml",
  "charter_count=2",
  "capability_count=2",
  "@subject-literacy",
  "bdd configured",
]) {
  if (!formatted.includes(expected)) {
    console.error(`❌ FAIL: formatted info missing ${expected}`);
    pass = false;
  }
}

const rawText = text(51);
let raw: any;
try {
  raw = JSON.parse(rawText);
} catch {
  raw = null;
}
console.log("=== info raw ===\n" + rawText.slice(0, 600) + "...\n");
if (!raw || raw.charter_count !== 2 || raw.capability_count !== 2) {
  console.error("❌ FAIL: raw counts malformed");
  pass = false;
}
if (raw?.bdd?.configured !== true || raw.bdd.report_format !== "cucumber-json") {
  console.error("❌ FAIL: raw bdd summary malformed");
  pass = false;
}
if (!raw?.capabilities?.some((c: any) => c.name === "subject-literacy.getByUid")) {
  console.error("❌ FAIL: raw capabilities missing getByUid");
  pass = false;
}

const noConfigText = text(52);
let noConfig: any;
try {
  noConfig = JSON.parse(noConfigText);
} catch {
  noConfig = null;
}
console.log("=== info no config raw ===\n" + noConfigText + "\n");
if (noConfig?.error !== "no_config") {
  console.error("❌ FAIL: no config should return error=no_config");
  pass = false;
}

await rm(noConfigRoot, { recursive: true, force: true });

if (pass) {
  console.log("\n✅ All Day 8 info tests passed");
} else {
  process.exit(1);
}
