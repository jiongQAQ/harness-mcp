#!/usr/bin/env bun
/**
 * Day 13 end-to-end test - flow tool.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-flow-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });
await mkdir(resolve(tmpRoot, "harness/flows"), { recursive: true });
await mkdir(resolve(tmpRoot, "target"), { recursive: true });

await writeFile(
  resolve(tmpRoot, "harness/flows/checkout.feature"),
  `# language: en
@flow @checkout
Feature: Complete checkout flow

  Scenario: paid order can be queried
    Given a buyer has a cart
    When the buyer pays
    Then the order can be queried
`,
  "utf-8",
);

const flowYaml = `version: 1
spec_dir: harness
charter_dir: harness/_charter

commands:
  run:
    cmd: 'echo "run should not execute from flow" && exit 42'
    workdir: "."
  flow:
    cmd: 'cp "$REPORT_SRC" target/flow-cucumber.json && echo'
    workdir: "."
    filter_pattern: '"flow={flow}"'
    report:
      format: cucumber-json
      path: target/flow-cucumber.json
    timeout_ms: 10000

ai_hints: ""
`;
await writeFile(resolve(tmpRoot, "harness.yaml"), flowYaml, "utf-8");

const report = JSON.stringify([
  {
    uri: "harness/flows/checkout.feature",
    name: "Complete checkout flow",
    elements: [
      {
        type: "scenario",
        name: "paid order can be queried",
        line: 5,
        steps: [{ name: "order can be queried", result: { status: "passed" } }],
      },
    ],
  },
]);
const reportSrc = resolve(tmpRoot, "_flow-report.json");
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
    clientInfo: { name: "test-day13-flow", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 90,
  method: "tools/call",
  params: { name: "flow", arguments: {} },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 91,
  method: "tools/call",
  params: { name: "flow", arguments: { name: "checkout", dryRun: true, raw: true } },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 92,
  method: "tools/call",
  params: { name: "flow", arguments: { name: "checkout" } },
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
assert(toolNames.includes("flow"), "flow tool is not registered");

const listing = text(90);
console.log("\n=== flow list ===\n" + listing + "\n");
assert(listing.includes("Flows: 1"), "flow list should show one flow");
assert(listing.includes("Complete checkout flow"), "flow list missing title");
assert(listing.includes("harness/flows/checkout.feature"), "flow list missing file");

const dryRunText = text(91);
let dryRun: any;
try {
  dryRun = JSON.parse(dryRunText);
} catch {
  dryRun = null;
}
console.log("=== flow dryRun raw ===\n" + dryRunText + "\n");
assert(dryRun?.command_type === "flow", "dryRun command_type should be flow");
assert(dryRun?.dry_run === true, "dryRun flag should be true");
assert(
  dryRun?.cmd?.includes('"flow=Complete checkout flow"'),
  "dryRun command should include expanded flow filter",
);
assert(dryRun?.exit_code === null, "dryRun should not execute command");

const runText = text(92);
console.log("=== flow run ===\n" + runText + "\n");
assert(runText.includes('"flow=Complete checkout flow"'), "run should include flow filter");
assert(runText.includes("Test Summary"), "run should include test summary");
assert(runText.includes("passed=1"), "run should include passed count");
assert(runText.includes("failed=0"), "run should include failed count");
assert(!runText.includes("run should not execute from flow"), "flow should not execute run command");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 13 flow tests passed");
} else {
  process.exit(1);
}
