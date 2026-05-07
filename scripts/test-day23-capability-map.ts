#!/usr/bin/env bun
/**
 * Day 23 end-to-end test - capability map governance.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-capability-map-`);

await mkdir(resolve(tmpRoot, "harness/features/demo"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
  "utf-8",
);

const validFeature = `# language: zh-CN
# capability: demo.createDraft
@demo

功能: 创建草稿

  业务来源:
    - 用户提供: 草稿创建需求

  意图:
    - 为用户创建可继续编辑的草稿。

  边界:
    - 本能力只承诺草稿创建语义。

  核心承诺:
    - 标题有效时必须返回草稿编号。

  风险:
    - AI 可能用默认标题兜底。

  待确认:
    - 无

  场景: 标题有效时创建草稿
    假设 用户输入有效标题
    当 创建草稿
    那么 应返回草稿编号
`;

const mapContent = `version: 1
domains:
  demo:
    capabilities:
      - id: demo.createDraft
        file: features/demo/create-draft.feature
        intent: 为用户创建可继续编辑的草稿
flows:
  - id: demo.createDraftJourney
    file: flows/create-draft-journey.feature
    uses:
      - demo.createDraft
`;

const duplicateFileMapContent = mapContent.replace(
  "      - id: demo.createDraft\n        file: features/demo/create-draft.feature\n        intent: 为用户创建可继续编辑的草稿",
  "      - id: demo.createDraft\n        file: features/demo/create-draft.feature\n        intent: 为用户创建可继续编辑的草稿\n      - id: demo.duplicateFile\n        file: features/demo/create-draft.feature\n        intent: 重复使用同一个 feature 文件",
);

const backslashMapContent = mapContent.replace(
  "features/demo/create-draft.feature",
  "features\\\\demo\\\\create-draft.feature",
);

const dotSegmentMapContent = mapContent.replace(
  "features/demo/create-draft.feature",
  "features/demo/./create-draft.feature",
);

const emptySegmentMapContent = mapContent.replace(
  "features/demo/create-draft.feature",
  "features/demo//create-draft.feature",
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
const parse = (id: number) => {
  try {
    return JSON.parse(text(id));
  } catch {
    return null;
  }
};

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-day23-capability-map", version: "0" },
  },
});
await wait(400);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(300);

send({
  jsonrpc: "2.0",
  id: 230,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features/demo/create-draft.feature",
      content: validFeature,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 231,
  method: "tools/call",
  params: {
    name: "update_map",
    arguments: {
      content: mapContent.replace("uses:\n      - demo.createDraft", "uses:\n      - demo.missing"),
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 232,
  method: "tools/call",
  params: {
    name: "update_map",
    arguments: {
      content: mapContent,
      raw: true,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 237,
  method: "tools/call",
  params: {
    name: "update_map",
    arguments: {
      content: duplicateFileMapContent,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 238,
  method: "tools/call",
  params: {
    name: "update_map",
    arguments: {
      content: backslashMapContent,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 241,
  method: "tools/call",
  params: {
    name: "update_map",
    arguments: {
      content: dotSegmentMapContent,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 242,
  method: "tools/call",
  params: {
    name: "update_map",
    arguments: {
      content: emptySegmentMapContent,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 233,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features/demo/wrong.feature",
      content: validFeature,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 234,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.notMapped",
      file: "features/demo/not-mapped.feature",
      content: validFeature.replace("demo.createDraft", "demo.notMapped"),
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 239,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features\\demo\\create-draft.feature",
      content: validFeature,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 235,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features/demo/create-draft.feature",
      content: validFeature,
      raw: true,
    },
  },
});
await wait(500);

await mkdir(resolve(tmpRoot, "harness/flows"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness/flows/create-draft-journey.feature"),
  `# language: zh-CN
@flow @demo

功能: 创建草稿用户旅程

  场景: 用户创建草稿
    假设 用户打开草稿页
    当 用户提交有效标题
    那么 应看到草稿编号
`,
  "utf-8",
);

send({
  jsonrpc: "2.0",
  id: 236,
  method: "tools/call",
  params: { name: "doctor", arguments: { raw: true } },
});
await wait(500);

await writeFile(
  resolve(tmpRoot, "harness/capability-map.yaml"),
  duplicateFileMapContent,
  "utf-8",
);

send({
  jsonrpc: "2.0",
  id: 240,
  method: "tools/call",
  params: { name: "doctor", arguments: { raw: true } },
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
assert(toolNames.includes("update_map"), "update_map tool is not registered");

console.log("\n=== create_spec without map ===\n" + text(230) + "\n");
assert(text(230).includes("capability-map.yaml"), "create_spec should require capability map");

console.log("=== invalid update_map ===\n" + text(231) + "\n");
assert(text(231).includes("未知 capability"), "update_map should reject flows using unknown capabilities");

console.log("=== duplicate file update_map ===\n" + text(237) + "\n");
assert(text(237).includes("重复 capability file"), "update_map should reject duplicate capability files");

console.log("=== backslash path update_map ===\n" + text(238) + "\n");
assert(text(238).includes("不能包含反斜杠"), "update_map should reject backslash paths");

console.log("=== dot segment path update_map ===\n" + text(241) + "\n");
assert(text(241).includes("不能包含 . 路径段"), "update_map should reject dot path segments");

console.log("=== empty segment path update_map ===\n" + text(242) + "\n");
assert(text(242).includes("不能包含空路径段"), "update_map should reject empty path segments");

const updated = parse(232);
console.log("=== update_map raw ===\n" + text(232) + "\n");
assert(updated?.ok === true, "update_map should succeed");
assert(updated?.capability_count === 1, "update_map capability count mismatch");
assert(updated?.flow_count === 1, "update_map flow count mismatch");

console.log("=== create_spec wrong map file ===\n" + text(233) + "\n");
assert(text(233).includes("capability-map.yaml"), "wrong file should mention capability map");
assert(text(233).includes("features/demo/create-draft.feature"), "wrong file should show expected map file");

console.log("=== create_spec unmapped ===\n" + text(234) + "\n");
assert(text(234).includes("未在 capability-map.yaml 中声明"), "unmapped capability should be rejected");

console.log("=== create_spec backslash path ===\n" + text(239) + "\n");
assert(text(239).includes("不能包含反斜杠"), "create_spec should reject backslash paths");

const created = parse(235);
console.log("=== create_spec mapped success ===\n" + text(235) + "\n");
assert(created?.ok === true, "mapped create_spec should succeed");

const onDiskMap = await readFile(resolve(tmpRoot, "harness/capability-map.yaml"), "utf-8");
assert(onDiskMap.includes("demo.createDraft"), "capability map was not written");

const doctor = parse(236);
console.log("=== doctor map alignment ===\n" + text(236).slice(0, 1600) + "\n");
assert(
  doctor?.checks?.some((c: any) => c.id === "capability_map.exists" && c.level === "pass"),
  "doctor should pass capability_map.exists",
);
assert(
  doctor?.checks?.some((c: any) => c.id === "capability_map.valid" && c.level === "pass"),
  "doctor should pass capability_map.valid",
);
assert(
  doctor?.checks?.some((c: any) => c.id === "capability_map.capabilities" && c.level === "pass"),
  "doctor should pass capability map capability alignment",
);
assert(
  doctor?.checks?.some((c: any) => c.id === "capability_map.flows" && c.level === "pass"),
  "doctor should pass capability map flow alignment",
);

const duplicateDoctor = parse(240);
console.log("=== doctor duplicate map file ===\n" + text(240).slice(0, 1200) + "\n");
assert(
  duplicateDoctor?.checks?.some((c: any) => c.id === "capability_map.valid" && c.level === "fail"),
  "doctor should fail invalid duplicate capability file map",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 23 capability map tests passed");
} else {
  process.exit(1);
}
