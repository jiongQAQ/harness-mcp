#!/usr/bin/env bun
/**
 * Day 9 end-to-end test — doctor tool.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-doctor-`);
const noConfigRoot = resolve(tmpRoot, "empty");
const missingCapabilityRoot = resolve(tmpRoot, "missing-capability");
const duplicateCapabilityRoot = resolve(tmpRoot, "duplicate-capability");
const unsupportedReportRoot = resolve(tmpRoot, "unsupported-report");

await cp(fixtureRoot, missingCapabilityRoot, { recursive: true });
await cp(fixtureRoot, duplicateCapabilityRoot, { recursive: true });
await cp(fixtureRoot, unsupportedReportRoot, { recursive: true });
await mkdir(noConfigRoot, { recursive: true });

const getByUidPath = "harness/ai-learning/subject-literacy/getByUid.feature";
const deleteByIdPath = "harness/ai-learning/subject-literacy/deleteById.feature";

const missingFile = resolve(missingCapabilityRoot, getByUidPath);
const missingContent = await readFile(missingFile, "utf-8");
await writeFile(
  missingFile,
  missingContent.replace(/^# capability: .+\n/m, ""),
  "utf-8",
);

const dupFile = resolve(duplicateCapabilityRoot, deleteByIdPath);
const dupContent = await readFile(dupFile, "utf-8");
await writeFile(
  dupFile,
  dupContent.replace(
    /^# capability: .+$/m,
    "# capability: subject-literacy.getByUid",
  ),
  "utf-8",
);

const unsupportedYaml = await readFile(
  resolve(unsupportedReportRoot, "harness.yaml"),
  "utf-8",
);
await writeFile(
  resolve(unsupportedReportRoot, "harness.yaml"),
  unsupportedYaml.replace("format: cucumber-json", "format: surefire-xml"),
  "utf-8",
);

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
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
    clientInfo: { name: "test-day9-doctor", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 60,
  method: "tools/call",
  params: { name: "doctor", arguments: {} },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 61,
  method: "tools/call",
  params: { name: "doctor", arguments: { raw: true } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 62,
  method: "tools/call",
  params: { name: "doctor", arguments: { raw: true, path: noConfigRoot } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 63,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: missingCapabilityRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 64,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: duplicateCapabilityRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 65,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: unsupportedReportRoot },
  },
});
await wait(500);

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
assert(toolNames.includes("doctor"), "doctor tool is not registered");

const formatted = text(60);
console.log("\n=== doctor formatted ===\n" + formatted + "\n");
assert(formatted.includes("Doctor:"), "formatted output missing Doctor header");
assert(formatted.includes("PASS"), "formatted output missing PASS group");
assert(formatted.includes("WARN"), "formatted output missing WARN group");
assert(formatted.includes("config.exists"), "formatted output missing config check");

const normal = parse(61);
console.log("=== doctor raw normal ===\n" + text(61).slice(0, 800) + "...\n");
assert(["pass", "warn"].includes(normal?.status), "normal status should pass or warn");
assert(
  normal?.checks?.some((c: any) => c.id === "capabilities.metadata" && c.level === "pass"),
  "normal fixture should pass capability metadata check",
);

const noConfig = parse(62);
console.log("=== doctor raw no config ===\n" + text(62) + "\n");
assert(noConfig?.status === "fail", "no config status should fail");
assert(
  noConfig?.checks?.some((c: any) => c.id === "config.exists" && c.level === "fail"),
  "no config should fail config.exists",
);

const missingCapability = parse(63);
console.log(
  "=== doctor raw missing capability ===\n" +
    text(63).slice(0, 800) +
    "...\n",
);
assert(missingCapability?.status === "fail", "missing capability status should fail");
assert(
  missingCapability?.checks?.some(
    (c: any) => c.id === "capabilities.metadata" && c.level === "fail",
  ),
  "missing capability should fail metadata check",
);

const duplicateCapability = parse(64);
console.log(
  "=== doctor raw duplicate capability ===\n" +
    text(64).slice(0, 800) +
    "...\n",
);
assert(duplicateCapability?.status === "fail", "duplicate capability status should fail");
assert(
  duplicateCapability?.checks?.some(
    (c: any) => c.id === "capabilities.unique" && c.level === "fail",
  ),
  "duplicate capability should fail unique check",
);

const unsupportedReport = parse(65);
console.log(
  "=== doctor raw unsupported report ===\n" +
    text(65).slice(0, 800) +
    "...\n",
);
assert(unsupportedReport?.status === "fail", "unsupported report status should fail");
assert(
  unsupportedReport?.checks?.some(
    (c: any) => c.id === "verify.report.format" && c.level === "fail",
  ),
  "unsupported report should fail report format check",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\n✅ All Day 9 doctor tests passed");
} else {
  process.exit(1);
}
