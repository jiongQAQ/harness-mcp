#!/usr/bin/env bun
/**
 * Day 7-8 端到端测试 — verify
 *
 * 在 tmp 目录搭建一个假项目:
 *   harness.yaml.bdd.cmd 用 echo 写一个固定的 cucumber.json 出来
 *   两份:全绿 / 一个失败
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";

const fixtureRoot = resolve(import.meta.dir, "../examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-verify-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });

const reportPath = resolve(tmpRoot, "target/cucumber.json");
await mkdir(resolve(tmpRoot, "target"), { recursive: true });

// 改 harness.yaml — bdd.cmd 用 sh -c,把 name_filter_pattern 当成 echo 参数验证模板替换
const verifyYaml = `version: 1
spec_dir: harness
charter_dir: harness/_charter

bdd:
  runner: cucumber-js
  cmd: 'cp "$REPORT_SRC" target/cucumber.json && echo'
  workdir: "."
  feature_arg_pattern: '"{feature}"'
  name_filter_pattern: '"bdd-name={name}"'
  report:
    format: cucumber-json
    path: target/cucumber.json
  timeout_ms: 10000

ai_hints: ""
`;
await writeFile(resolve(tmpRoot, "harness.yaml"), verifyYaml);

// 准备两份报告
const reportPass = JSON.stringify([
  {
    uri: "harness/ai-learning/subject-literacy/getByUid.feature",
    name: "按知识图谱节点UID查询学科素养",
    elements: [
      {
        type: "scenario",
        name: "uid 下挂多条 — 全部返回",
        line: 17,
        steps: [{ name: "测试", result: { status: "passed" } }],
      },
      {
        type: "scenario",
        name: "uid 下无记录 — 返回空列表",
        line: 25,
        steps: [{ name: "测试", result: { status: "passed" } }],
      },
    ],
  },
  {
    uri: "harness/ai-learning/subject-literacy/deleteById.feature",
    name: "按主键ID软删学科素养",
    elements: [
      {
        type: "scenario",
        name: "正常删除",
        line: 23,
        steps: [{ name: "测试", result: { status: "passed" } }],
      },
    ],
  },
]);

const reportFail = JSON.stringify([
  {
    uri: "harness/ai-learning/subject-literacy/getByUid.feature",
    name: "按知识图谱节点UID查询学科素养",
    elements: [
      {
        type: "scenario",
        name: "uid 下挂多条 — 全部返回",
        line: 17,
        steps: [
          { name: "调用", result: { status: "passed" } },
          {
            name: "断言 data 应包含 2 条记录",
            result: {
              status: "failed",
              error_message: "Expected 2, got 0\n at line 22",
            },
          },
        ],
      },
      {
        type: "scenario",
        name: "uid 下无记录 — 返回空列表",
        line: 25,
        steps: [{ name: "断言", result: { status: "passed" } }],
      },
    ],
  },
]);

const passSrc = resolve(tmpRoot, "_pass.json");
const failSrc = resolve(tmpRoot, "_fail.json");
await writeFile(passSrc, reportPass);
await writeFile(failSrc, reportFail);

// 起 server
const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: resolve(import.meta.dir, ".."),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_PROJECT_ROOT: tmpRoot,
    REPORT_SRC: passSrc,
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
    try { responses.push(JSON.parse(line)); } catch {}
  }
});
proc.stderr.on("data", (c: Buffer) => process.stderr.write(`[err] ${c}`));

const send = (req: any) => proc.stdin.write(JSON.stringify(req) + "\n");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

send({ jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
await wait(400);

// Case A: pass scenario(REPORT_SRC=_pass.json,无 capability)
send({ jsonrpc: "2.0", id: 40, method: "tools/call",
  params: { name: "verify", arguments: {} } });
await wait(2000);

proc.kill();
await wait(200);

// 启第二轮 server,这次 REPORT_SRC=_fail.json
const proc2 = spawn("bun", ["run", "src/index.ts"], {
  cwd: resolve(import.meta.dir, ".."),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HARNESS_PROJECT_ROOT: tmpRoot,
    REPORT_SRC: failSrc,
  },
});

const r2: any[] = [];
let buf2 = "";
proc2.stdout.on("data", (c: Buffer) => {
  buf2 += c.toString();
  const ls = buf2.split("\n");
  buf2 = ls.pop() ?? "";
  for (const l of ls) {
    if (!l.trim()) continue;
    try { r2.push(JSON.parse(l)); } catch {}
  }
});
proc2.stderr.on("data", (c: Buffer) => process.stderr.write(`[err2] ${c}`));

proc2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
await wait(400);
proc2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/call",
  params: { name: "verify", arguments: { capability: "getByUid" } } }) + "\n");
await wait(2000);
proc2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call",
  params: { name: "verify", arguments: { capability: "getByUid", raw: true } } }) + "\n");
await wait(2000);

proc2.kill();
await wait(200);

let pass = true;
const txt = (arr: any[], id: number) => arr.find((r) => r.id === id)?.result?.content?.[0]?.text ?? "";

const a = txt(responses, 40);
console.log("=== A: verify all pass ===\n" + a + "\n");
if (!a.includes("passed=3") || !a.includes("failed=0")) {
  console.error("❌ FAIL: A — should report 3 passed");
  pass = false;
}
if (a.includes("Git Diff")) {
  console.error("❌ FAIL: A — verify should not include git diff by default");
  pass = false;
}

const b = txt(r2, 41);
console.log("=== B: verify with failure (capability=getByUid) ===\n" + b + "\n");
if (!b.includes("failed=1") || !b.includes("passed=1")) {
  console.error("❌ FAIL: B summary");
  pass = false;
}
if (!b.includes("Expected 2, got 0")) {
  console.error("❌ FAIL: B should show error message");
  pass = false;
}
if (!b.includes('"bdd-name=subject-literacy.getByUid"')) {
  console.error("❌ FAIL: B should expand name_filter_pattern");
  pass = false;
}

const c = txt(r2, 42);
let raw: any;
try { raw = JSON.parse(c); } catch {}
if (!raw || raw.exit_code !== 0 || raw.report?.failures?.length !== 1) {
  console.error("❌ FAIL: C raw report malformed");
  pass = false;
} else if (raw.git_diff !== null) {
  console.error("❌ FAIL: C raw should not include git diff by default");
  pass = false;
} else {
  console.log("=== C: raw OK (failures=1, capability=" + raw.capability + ") ===\n");
}

await rm(tmpRoot, { recursive: true, force: true });

if (pass) console.log("\n✅ All Day 7-8 tests passed");
else process.exit(1);
