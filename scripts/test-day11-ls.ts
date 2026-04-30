#!/usr/bin/env bun
/**
 * Day 11 end-to-end test — ls tool.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const workspaceRoot = await mkdtemp(`${tmpdir()}/harness-mcp-ls-`);

const serviceA = resolve(workspaceRoot, "service-a");
const serviceB = resolve(workspaceRoot, "apps/service-b");
const ignoredService = resolve(workspaceRoot, "node_modules/ignored-service");

await cp(fixtureRoot, serviceA, { recursive: true });
await mkdir(resolve(workspaceRoot, "apps"), { recursive: true });
await cp(fixtureRoot, serviceB, { recursive: true });
await mkdir(resolve(workspaceRoot, "node_modules"), { recursive: true });
await cp(fixtureRoot, ignoredService, { recursive: true });

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HARNESS_PROJECT_ROOT: workspaceRoot },
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
    clientInfo: { name: "test-day11-ls", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 70,
  method: "tools/call",
  params: { name: "ls", arguments: { raw: true, path: workspaceRoot } },
});
await wait(700);

send({
  jsonrpc: "2.0",
  id: 71,
  method: "tools/call",
  params: {
    name: "ls",
    arguments: { raw: true, path: workspaceRoot, depth: 1 },
  },
});
await wait(700);

send({
  jsonrpc: "2.0",
  id: 72,
  method: "tools/call",
  params: { name: "ls", arguments: { path: workspaceRoot } },
});
await wait(700);

proc.kill();
await wait(200);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`❌ FAIL: ${message}`);
    pass = false;
  }
};
const parse = (id: number) => {
  try {
    return JSON.parse(text(id));
  } catch {
    return null;
  }
};

const tools = responses.find((r) => r.id === 2);
const toolNames = (tools?.result?.tools ?? []).map((t: any) => t.name);
console.log("Tools registered:", toolNames);
assert(toolNames.includes("ls"), "ls tool is not registered");

const all = parse(70);
console.log("\n=== ls raw depth default ===\n" + text(70).slice(0, 1000) + "\n");
assert(all?.root === workspaceRoot, "raw root mismatch");
assert(all?.package_count === 2, "default depth should find 2 real packages");
assert(
  all?.packages?.some((p: any) => p.relative_path === "service-a"),
  "missing service-a",
);
assert(
  all?.packages?.some((p: any) => p.relative_path === "apps/service-b"),
  "missing nested service-b",
);
assert(
  !all?.packages?.some((p: any) => p.relative_path.includes("node_modules")),
  "should ignore node_modules projects",
);
assert(
  all?.packages?.every((p: any) => p.capability_count === 2),
  "each fixture package should summarize 2 capabilities",
);

const shallow = parse(71);
console.log("=== ls raw depth 1 ===\n" + text(71).slice(0, 1000) + "\n");
assert(shallow?.package_count === 1, "depth=1 should only find service-a");
assert(
  shallow?.packages?.[0]?.relative_path === "service-a",
  "depth=1 result should be service-a",
);

const formatted = text(72);
console.log("=== ls formatted ===\n" + formatted + "\n");
assert(formatted.includes("Harness projects: 2"), "formatted count missing");
assert(formatted.includes("service-a"), "formatted missing service-a");
assert(formatted.includes("apps/service-b"), "formatted missing service-b");

await rm(workspaceRoot, { recursive: true, force: true });

if (pass) {
  console.log("\n✅ All Day 11 ls tests passed");
} else {
  process.exit(1);
}
