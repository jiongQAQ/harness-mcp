#!/usr/bin/env bun
/**
 * Day 4 端到端测试 — read_spec + search
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
    try { responses.push(JSON.parse(line)); } catch {}
  }
});
proc.stderr.on("data", (c: Buffer) => process.stderr.write(`[err] ${c}`));

const send = (req: any) => proc.stdin.write(JSON.stringify(req) + "\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

send({ jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
await wait(400);

// read_spec 精确命中
send({ jsonrpc: "2.0", id: 10, method: "tools/call",
  params: { name: "read_spec", arguments: { capability: "getByUid" } } });
await wait(300);

// read_spec 多命中
send({ jsonrpc: "2.0", id: 11, method: "tools/call",
  params: { name: "read_spec", arguments: { capability: "subject-literacy" } } });
await wait(300);

// read_spec 0 命中
send({ jsonrpc: "2.0", id: 12, method: "tools/call",
  params: { name: "read_spec", arguments: { capability: "no-such-thing" } } });
await wait(300);

// search 命中多文件
send({ jsonrpc: "2.0", id: 20, method: "tools/call",
  params: { name: "search", arguments: { query: "uid", context_lines: 1 } } });
await wait(300);

// search 0 命中
send({ jsonrpc: "2.0", id: 21, method: "tools/call",
  params: { name: "search", arguments: { query: "totally-absent-xyz" } } });
await wait(300);

// raw 模式
send({ jsonrpc: "2.0", id: 22, method: "tools/call",
  params: { name: "read_spec", arguments: { capability: "deleteById", raw: true } } });
await wait(300);

proc.kill();
await wait(200);

let pass = true;
const text = (id: number) => responses.find((r) => r.id === id)?.result?.content?.[0]?.text ?? "";

const r10 = text(10);
console.log("=== read_spec capability=getByUid ===\n" + r10.slice(0, 500) + "...\n");
if (!r10.includes("subject-literacy.getByUid") || !r10.includes("勾股定理")) {
  console.error("❌ FAIL: read_spec exact match");
  pass = false;
}

const r11 = text(11);
console.log("=== read_spec capability=subject-literacy (ambiguous) ===\n" + r11);
if (!r11.includes("命中 2") && !r11.includes("命中")) {
  console.error("❌ FAIL: should report ambiguous");
  pass = false;
}

const r12 = text(12);
console.log("\n=== read_spec capability=no-such-thing ===\n" + r12);
if (!r12.includes("未找到")) {
  console.error("❌ FAIL: should be not_found");
  pass = false;
}

const r20 = text(20);
console.log("\n=== search query=uid ===\n" + r20.slice(0, 600) + "...\n");
if (!r20.includes("matches in")) {
  console.error("❌ FAIL: search hits empty");
  pass = false;
}

const r21 = text(21);
console.log("=== search query=totally-absent-xyz ===\n" + r21);
if (!r21.includes("no matches")) {
  console.error("❌ FAIL: should be no matches");
  pass = false;
}

const r22 = text(22);
let raw: any;
try { raw = JSON.parse(r22); } catch { raw = null; }
console.log("\n=== read_spec raw deleteById ===\n" + r22.slice(0, 200) + "...");
if (!raw || raw.name !== "subject-literacy.deleteById" || !raw.content) {
  console.error("❌ FAIL: raw read_spec malformed");
  pass = false;
}

if (pass) console.log("\n✅ All Day 4 tests passed");
else process.exit(1);
