#!/usr/bin/env bun
/**
 * Day 15 end-to-end test - create_spec tool.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-create-spec-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness/capability-map.yaml"),
  `version: 1
domains:
  demo:
    capabilities:
      - id: demo.createDraft
        file: features/demo/create-draft.feature
        intent: 创建草稿
      - id: demo.other
        file: features/demo/existing-file.feature
        intent: 文件已存在校验
      - id: demo.mismatch
        file: features/demo/mismatch.feature
        intent: capability 不匹配校验
      - id: demo.invalid
        file: features/demo/invalid.feature
        intent: Gherkin 语法校验
flows: []
`,
  "utf-8",
);
await mkdir(resolve(tmpRoot, "harness/features/demo"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness/features/demo/existing-file.feature"),
  `# language: zh-CN
# capability: demo.preExistingForeign
@demo

功能: 已存在文件

  场景: 占位文件
    假设 文件已存在
    当 创建同路径能力
    那么 应拒绝覆盖
`,
  "utf-8",
);

const proc = spawn("bun", ["run", "src/index.ts"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HARNESS_PROJECT_ROOT: tmpRoot },
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
    clientInfo: { name: "test-day15-create-spec", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

const validContent = `# language: zh-CN
# capability: demo.createDraft
@demo

功能: 创建草稿

  业务来源:
    - PRD: 用户提供的草稿管理需求

  意图:
    - 为用户创建可继续编辑的草稿。

  边界:
    - 本能力只承诺草稿创建语义，不规定具体代码类结构。

  核心承诺:
    - 标题有效时必须返回可追踪的草稿编号。
    - 标题为空时必须显式失败，不能静默创建默认草稿。

  风险:
    - AI 可能为了跑通而用默认标题兜底。

  待确认:
    - 无

  场景: 标题有效时创建草稿
    假设 用户输入标题 "第一篇"
    当 创建草稿
    那么 应返回草稿编号
`;

send({
  jsonrpc: "2.0",
  id: 109,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.legacyPath",
      file: "demo/legacy-path.feature",
      content: validContent.replace("demo.createDraft", "demo.legacyPath"),
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 110,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features/demo/create-draft.feature",
      content: validContent,
      raw: true,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 111,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features/demo/create-draft.feature",
      content: validContent,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 112,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.other",
      file: "features/demo/existing-file.feature",
      content: validContent.replace("demo.createDraft", "demo.other"),
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 113,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.mismatch",
      file: "features/demo/mismatch.feature",
      content: validContent,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 114,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.escape",
      file: "../escape.feature",
      content: validContent.replace("demo.createDraft", "demo.escape"),
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 115,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.invalid",
      file: "features/demo/invalid.feature",
      content: "# language: zh-CN\n# capability: demo.invalid\n没有 Feature 行\n",
    },
  },
});
await wait(500);

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
assert(toolNames.includes("create_spec"), "create_spec tool is not registered");

const legacyPath = text(109);
console.log("\n=== legacy capability path ===\n" + legacyPath + "\n");
assert(
  legacyPath.includes("features/<业务域>"),
  "create_spec should reject capability files outside features/<业务域>",
);

const createdText = text(110);
let created: any;
try {
  created = JSON.parse(createdText);
} catch {
  created = null;
}
console.log("\n=== create_spec raw success ===\n" + createdText + "\n");
assert(created?.ok === true, "create_spec should succeed");
assert(created?.capability === "demo.createDraft", "created capability mismatch");
assert(created?.file === "harness/features/demo/create-draft.feature", "created file mismatch");
assert(created?.scenario_count === 1, "created scenario count mismatch");
assert(
  created?.next_required_action === "Feature Contract Review",
  "create_spec success should require Feature Contract Review next",
);

if (created?.ok === true) {
  const onDisk = await readFile(
    resolve(tmpRoot, "harness/features/demo/create-draft.feature"),
    "utf-8",
  );
  assert(onDisk.includes("# capability: demo.createDraft"), "created file missing capability");
  assert(onDisk.includes("功能: 创建草稿"), "created file missing feature title");
}

const duplicateCapability = text(111);
console.log("=== duplicate capability ===\n" + duplicateCapability + "\n");
assert(duplicateCapability.includes("能力已存在"), "duplicate capability should be rejected");

const fileExists = text(112);
console.log("=== file exists ===\n" + fileExists + "\n");
assert(fileExists.includes("文件已存在"), "existing file should be rejected");

const mismatch = text(113);
console.log("=== capability mismatch ===\n" + mismatch + "\n");
assert(mismatch.includes("# capability"), "mismatched capability should be rejected");

const escape = text(114);
console.log("=== path escape ===\n" + escape + "\n");
assert(escape.includes("file 必须是 spec_dir 内"), "path escape should be rejected");

const invalid = text(115);
console.log("=== invalid gherkin ===\n" + invalid + "\n");
assert(invalid.includes("Gherkin 语法错误"), "invalid gherkin should be rejected");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 15 create_spec tests passed");
} else {
  process.exit(1);
}
