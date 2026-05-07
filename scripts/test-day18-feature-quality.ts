#!/usr/bin/env bun
/**
 * Day 18 end-to-end test - feature quality gate.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-feature-quality-`);

await mkdir(resolve(tmpRoot, "harness/AnswerUserApiService"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/constraints"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/flows"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
ai_hints: ""
`,
  "utf-8",
);
await writeFile(
  resolve(tmpRoot, "harness/capability-map.yaml"),
  `version: 1
domains:
  demo:
    capabilities:
      - id: demo.createDraft
        file: features/demo/create-draft.feature
        intent: 创建草稿
      - id: demo.missingSource
        file: features/demo/missing-source.feature
        intent: 缺少业务来源校验
      - id: demo.missingPromise
        file: features/demo/missing-promise.feature
        intent: 缺少核心承诺校验
      - id: demo.emptyPending
        file: features/demo/empty-pending.feature
        intent: 空待确认校验
      - id: demo.noSourceKeyword
        file: features/demo/no-source-keyword.feature
        intent: 业务来源类型校验
      - id: demo.missingLanguage
        file: features/demo/missing-language.feature
        intent: 缺少中文语言头校验
flows: []
`,
  "utf-8",
);

const fullContract = (capability: string) => `# language: zh-CN
# capability: ${capability}
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

const missingSource = fullContract("demo.missingSource").replace(
  /  业务来源:\n    - PRD: 用户提供的草稿管理需求\n\n/m,
  "",
);
const missingPromise = fullContract("demo.missingPromise").replace(
  /  核心承诺:\n    - 标题有效时必须返回可追踪的草稿编号。\n    - 标题为空时必须显式失败，不能静默创建默认草稿。\n\n/m,
  "",
);
const emptyPending = fullContract("demo.emptyPending").replace(
  /  待确认:\n    - 无\n\n/m,
  "  待确认:\n\n",
);
const noSourceKeyword = fullContract("demo.noSourceKeyword").replace(
  "PRD: 用户提供的草稿管理需求",
  "来自草稿管理需求",
);
const missingLanguage = fullContract("demo.missingLanguage").replace(
  "# language: zh-CN\n",
  "",
);

await writeFile(
  resolve(tmpRoot, "harness/AnswerUserApiService/start.feature"),
  fullContract("demo.codePath"),
  "utf-8",
);
await writeFile(
  resolve(tmpRoot, "harness/constraints/no-debug.feature"),
  `# language: zh-CN
功能: 禁止调试输出

  场景: 发现 console.log
    假设 扫描本次新增的 "src/**/*.ts" 行
    当 匹配到 "console\\\\.log"
    那么 应该报错 "本次修改新增了调试输出"
    而且 修正方式为 "删除调试输出；确需日志时使用项目统一 logger"
`,
  "utf-8",
);
await writeFile(
  resolve(tmpRoot, "harness/flows/create-draft.feature"),
  `# language: zh-CN
功能: 创建草稿端到端流程

  场景: 用户创建草稿
    假设 用户打开草稿页
    当 用户提交标题
    那么 应看到草稿编号
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
    clientInfo: { name: "test-day18-feature-quality", version: "0" },
  },
});
await wait(400);

send({
  jsonrpc: "2.0",
  id: 200,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.createDraft",
      file: "features/demo/create-draft.feature",
      content: fullContract("demo.createDraft"),
      raw: true,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 201,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.missingSource",
      file: "features/demo/missing-source.feature",
      content: missingSource,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 202,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.missingPromise",
      file: "features/demo/missing-promise.feature",
      content: missingPromise,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 203,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.emptyPending",
      file: "features/demo/empty-pending.feature",
      content: emptyPending,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 204,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.noSourceKeyword",
      file: "features/demo/no-source-keyword.feature",
      content: noSourceKeyword,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 205,
  method: "tools/call",
  params: {
    name: "update_spec",
    arguments: {
      capability: "demo.createDraft",
      content: missingPromise.replace("demo.missingPromise", "demo.createDraft"),
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 206,
  method: "tools/call",
  params: {
    name: "create_spec",
    arguments: {
      capability: "demo.missingLanguage",
      file: "features/demo/missing-language.feature",
      content: missingLanguage,
    },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 207,
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

const created = parse(200);
console.log("=== create_spec full contract ===\n" + text(200) + "\n");
assert(created?.ok === true, "full business contract should be accepted");

console.log("=== missing source ===\n" + text(201) + "\n");
assert(text(201).includes("Feature 质量检查失败"), "missing source should fail quality gate");
assert(text(201).includes("业务来源"), "missing source failure should mention 业务来源");

console.log("=== missing promise ===\n" + text(202) + "\n");
assert(text(202).includes("核心承诺"), "missing core promise should fail");

console.log("=== empty pending ===\n" + text(203) + "\n");
assert(text(203).includes("待确认"), "empty pending section should fail");

console.log("=== no source keyword ===\n" + text(204) + "\n");
assert(text(204).includes("业务来源"), "business source without source type should fail");
assert(text(204).includes("PRD"), "source keyword failure should list accepted source types");

console.log("=== update_spec shallow rewrite ===\n" + text(205) + "\n");
assert(text(205).includes("Feature 质量检查失败"), "update_spec should reject shallow rewrite");
assert(text(205).includes("核心承诺"), "update quality failure should mention missing section");

console.log("=== missing language ===\n" + text(206) + "\n");
assert(text(206).includes("Feature 质量检查失败"), "missing language should fail quality gate");
assert(text(206).includes("# language: zh-CN"), "missing language failure should mention zh-CN header");

const doctor = parse(207);
console.log("=== doctor feature quality ===\n" + text(207).slice(0, 1600) + "\n");
assert(["warn", "fail"].includes(doctor?.status), "doctor should surface code-module-like feature path diagnostics");
assert(
  doctor?.checks?.some((c: any) => c.id === "feature_quality.required_sections" && c.level === "pass"),
  "doctor should pass required sections for complete features",
);
assert(
  doctor?.checks?.some((c: any) => c.id === "feature_quality.path_style" && c.level === "warn"),
  "doctor should warn about code module style path",
);
assert(
  !doctor?.checks?.some(
    (c: any) => {
      const isFeatureQuality = String(c.id ?? "").startsWith("feature_quality.");
      const detail = String(c.detail ?? "");
      return (
        isFeatureQuality &&
        (detail.includes("constraints/no-debug.feature") ||
          detail.includes("flows/create-draft.feature"))
      );
    },
  ),
  "doctor should not apply capability quality checks to constraints or flows",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 18 feature quality tests passed");
} else {
  process.exit(1);
}
