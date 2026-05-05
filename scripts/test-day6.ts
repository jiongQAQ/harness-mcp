#!/usr/bin/env bun
/**
 * Day 6 端到端测试 — update_spec
 * 在 tmp 目录复制 fixture,改完后还原。
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdtemp, cp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const fixtureRoot = resolve(import.meta.dir, "../examples/sel-service-yaml");
const tmpDir = await mkdtemp(`${tmpdir()}/harness-mcp-test-`);
await cp(fixtureRoot, tmpDir, { recursive: true });

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: resolve(import.meta.dir, ".."),
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HARNESS_PROJECT_ROOT: tmpDir },
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

// Case A: 合法 Gherkin,应写入成功
const validNew = `# language: zh-CN
# capability: subject-literacy.getByUid
@subject-literacy

功能: 按知识图谱节点UID查询学科素养(更新版)

  业务来源:
    - 用户提供: 学科素养按知识图谱节点展示的业务需求变更
    - 代码推断: SubjectLiteracyApiServiceImpl#getByUid

  意图:
    - 让调用方按知识图谱节点 uid 和学段获取该节点下挂载的学科素养内容。

  边界:
    - 本能力只定义按 uid 查询的业务语义，不定义前端展示和编辑逻辑。

  核心承诺:
    - uid 是知识图谱节点 id,不是 examId。
    - 查询必须严格排除软删除记录。
    - stage 过滤参数必须影响返回结果。

  风险:
    - AI 可能忽略 stage 参数导致跨学段数据混入。

  待确认:
    - 无

  场景: stage=primary 过滤
    假设 仓储入参 ("node-1", "primary") 时返回 1 条
    当 调用 getByUid 入参 "node-1" stage "primary"
    那么 应返回 1 条
`;

send({ jsonrpc: "2.0", id: 30, method: "tools/call",
  params: { name: "update_spec", arguments: { capability: "getByUid", content: validNew } } });
await wait(500);

// Case B: 不合法 Gherkin(无 Feature 行),应拒绝
const invalidGherkin = `# language: zh-CN
# capability: subject-literacy.getByUid
随便写的纯文本,没有 Feature 行
`;
send({ jsonrpc: "2.0", id: 31, method: "tools/call",
  params: { name: "update_spec", arguments: { capability: "getByUid", content: invalidGherkin } } });
await wait(500);

// Case C: 模糊命中多个,应拒绝
send({ jsonrpc: "2.0", id: 32, method: "tools/call",
  params: { name: "update_spec", arguments: { capability: "subject-literacy", content: validNew } } });
await wait(500);

// Case D: 不存在能力,应拒绝
send({ jsonrpc: "2.0", id: 33, method: "tools/call",
  params: { name: "update_spec", arguments: { capability: "no-such", content: validNew } } });
await wait(500);

proc.kill();
await wait(200);

let pass = true;
const text = (id: number) => responses.find((r) => r.id === id)?.result?.content?.[0]?.text ?? "";

const a = text(30);
console.log("=== A: valid update ===\n" + a + "\n");
if (!a.includes("已更新") || !a.includes("Gherkin 校验通过")) {
  console.error("❌ FAIL: A");
  pass = false;
}

const onDisk = await readFile(resolve(tmpDir, "harness/ai-learning/subject-literacy/getByUid.feature"), "utf-8");
if (!onDisk.includes("(更新版)")) {
  console.error("❌ FAIL: file not actually updated");
  pass = false;
}

const b = text(31);
console.log("=== B: invalid gherkin ===\n" + b + "\n");
if (!b.includes("Gherkin 语法错误")) {
  console.error("❌ FAIL: B should reject");
  pass = false;
}

const c = text(32);
console.log("=== C: ambiguous ===\n" + c + "\n");
if (!c.includes("命中") || !c.includes("精确")) {
  console.error("❌ FAIL: C should reject ambiguous");
  pass = false;
}

const d = text(33);
console.log("=== D: not found ===\n" + d + "\n");
if (!d.includes("未找到")) {
  console.error("❌ FAIL: D should reject not_found");
  pass = false;
}

await rm(tmpDir, { recursive: true, force: true });

if (pass) console.log("\n✅ All Day 6 tests passed");
else process.exit(1);
