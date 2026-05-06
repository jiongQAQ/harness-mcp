#!/usr/bin/env bun
/**
 * Day 21 end-to-end test - surefire/JUnit XML report parsing.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-surefire-xml-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });
await mkdir(resolve(tmpRoot, "target"), { recursive: true });

await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter

bdd:
  runner: custom
  cmd: 'cp "$REPORT_SRC" target/junit.xml && echo'
  workdir: "."
  feature_arg_pattern: '"{feature}"'
  report:
    format: surefire-xml
    path: target/junit.xml
  timeout_ms: 10000
`,
  "utf-8",
);

const passXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="3" failures="0" errors="0" skipped="1">
  <testsuite name="user service" tests="3" failures="0" errors="0" skipped="1">
    <testcase classname="UserService" name="creates user" time="0.01"/>
    <testcase classname="UserService" name="updates user" time="0.02"/>
    <testcase classname="UserService" name="skips disabled case" time="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>
`;

const failXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="4" failures="1" errors="1" skipped="1">
  <testsuite name="user service" tests="2" failures="1" errors="0" skipped="0">
    <testcase classname="UserService" name="rejects invalid email" time="0.03">
      <failure message="Expected 400, received 200">AssertionError: Expected 400, received 200
        at UserService.test.ts:17
      </failure>
    </testcase>
    <testcase classname="UserService" name="creates user" time="0.01"/>
  </testsuite>
  <testsuite name="billing service" tests="2" failures="0" errors="1" skipped="1">
    <testcase classname="BillingService" name="charges card" time="0.02">
      <error message="database unavailable">Error: database unavailable</error>
    </testcase>
    <testcase classname="BillingService" name="skips unsupported currency" time="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>
`;

const passSrc = resolve(tmpRoot, "_pass.xml");
const failSrc = resolve(tmpRoot, "_fail.xml");
await writeFile(passSrc, passXml, "utf-8");
await writeFile(failSrc, failXml, "utf-8");

async function callVerify(reportSrc: string, id: number) {
  const proc = spawn("bun", ["run", "src/index.ts"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, HARNESS_PROJECT_ROOT: tmpRoot, REPORT_SRC: reportSrc },
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

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-day21-surefire-xml", version: "0" },
    },
  });
  await wait(400);
  send({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "verify", arguments: { raw: true } },
  });
  await wait(1000);
  proc.kill();
  await wait(200);

  const text =
    responses.find((response) => response.id === id)?.result?.content?.[0]?.text ??
    "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const passResult = await callVerify(passSrc, 210);
console.log("=== surefire pass raw ===\n" + JSON.stringify(passResult, null, 2) + "\n");
assert(passResult?.report?.summary?.total === 3, "pass XML should report total=3");
assert(passResult?.report?.summary?.passed === 2, "pass XML should report passed=2");
assert(passResult?.report?.summary?.skipped === 1, "pass XML should report skipped=1");
assert(passResult?.report?.summary?.failed === 0, "pass XML should report failed=0");

const failResult = await callVerify(failSrc, 211);
console.log("=== surefire fail raw ===\n" + JSON.stringify(failResult, null, 2) + "\n");
assert(failResult?.report?.summary?.total === 4, "fail XML should report total=4");
assert(failResult?.report?.summary?.passed === 1, "fail XML should report passed=1");
assert(failResult?.report?.summary?.skipped === 1, "fail XML should report skipped=1");
assert(failResult?.report?.summary?.failed === 2, "fail XML should count failures and errors as failed");
assert(failResult?.report?.failures?.length === 2, "fail XML should list two failed testcases");
assert(
  failResult?.report?.failures?.some((failure: any) =>
    String(failure.scenario).includes("rejects invalid email") &&
    String(failure.errorMessage).includes("Expected 400"),
  ),
  "fail XML should include failure message",
);
assert(
  failResult?.report?.failures?.some((failure: any) =>
    String(failure.scenario).includes("charges card") &&
    String(failure.errorMessage).includes("database unavailable"),
  ),
  "fail XML should include error message",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 21 surefire XML tests passed");
} else {
  process.exit(1);
}
