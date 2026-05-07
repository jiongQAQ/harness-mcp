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
const nonBusinessLanguageRoot = resolve(tmpRoot, "non-business-language");
const jsBddDetectRoot = resolve(tmpRoot, "js-bdd-detect");
const javaBddDetectRoot = resolve(tmpRoot, "java-bdd-detect");
const pythonBddDetectRoot = resolve(tmpRoot, "python-bdd-detect");
const misplacedFeatureRoot = resolve(tmpRoot, "misplaced-feature");
const broadCapabilityRoot = resolve(tmpRoot, "broad-capability");
const bddImplInHarnessRoot = resolve(tmpRoot, "bdd-impl-in-harness");
const stepsNamedContractRoot = resolve(tmpRoot, "steps-named-contract");

await cp(fixtureRoot, missingCapabilityRoot, { recursive: true });
await cp(fixtureRoot, duplicateCapabilityRoot, { recursive: true });
await cp(fixtureRoot, unsupportedReportRoot, { recursive: true });
await mkdir(noConfigRoot, { recursive: true });
await mkdir(resolve(nonBusinessLanguageRoot, "harness/billing"), { recursive: true });
await mkdir(resolve(nonBusinessLanguageRoot, "harness/_charter"), { recursive: true });
await mkdir(resolve(nonBusinessLanguageRoot, "harness/constraints"), { recursive: true });
await mkdir(resolve(nonBusinessLanguageRoot, "harness/flows"), { recursive: true });
await mkdir(resolve(jsBddDetectRoot, "harness"), { recursive: true });
await mkdir(resolve(javaBddDetectRoot, "harness"), { recursive: true });
await mkdir(resolve(pythonBddDetectRoot, "harness"), { recursive: true });
await mkdir(resolve(misplacedFeatureRoot, "harness/novel"), { recursive: true });
await mkdir(resolve(broadCapabilityRoot, "harness/features/content"), { recursive: true });
await mkdir(resolve(bddImplInHarnessRoot, "harness/bdd/steps"), { recursive: true });
await mkdir(resolve(stepsNamedContractRoot, "harness/features/onboarding/steps"), { recursive: true });

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
  unsupportedYaml.replace("format: cucumber-json", "format: pytest-json"),
  "utf-8",
);

await writeFile(
  resolve(nonBusinessLanguageRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
  "utf-8",
);
await writeFile(
  resolve(nonBusinessLanguageRoot, "harness/billing/create-order.feature"),
  `# language: zh-CN
# capability: billing.createOrder
@billing

功能: 创建订单

  业务来源:
    - PRD: 用户提供的订单创建需求

  意图:
    - 为用户创建一笔可追踪的订单。

  边界:
    - 本能力只定义订单创建的业务承诺。

  核心承诺:
    - 创建成功后必须返回订单编号。

  风险:
    - AI 可能用默认订单兜底失败输入。

  待确认:
    - 无

  场景: 有效信息创建订单
    假设 用户提交有效订单信息
    当 创建订单
    那么 应返回订单编号
`,
  "utf-8",
);
await writeFile(
  resolve(nonBusinessLanguageRoot, "harness/_charter/security.feature"),
  `功能: 安全约束

  场景: 不暴露内部错误
    假设 接口发生异常
    那么 响应不应包含堆栈信息
`,
  "utf-8",
);
await writeFile(
  resolve(nonBusinessLanguageRoot, "harness/constraints/no-debug.feature"),
  `功能: 禁止调试输出

  场景: 本次新增代码不应包含 console.log
    假设 扫描本次新增的 "src/**/*.ts" 行
    当 匹配到 "console\\.log"
    那么 应该报错 "本次修改新增了调试输出"
    而且 修正方式为 "删除调试输出；确需日志时使用项目统一 logger"
`,
  "utf-8",
);
await writeFile(
  resolve(nonBusinessLanguageRoot, "harness/flows/checkout.feature"),
  `功能: 下单端到端流程

  场景: 用户完成下单
    假设 用户打开下单页
    当 用户提交订单
    那么 应看到订单编号
`,
  "utf-8",
);
await writeFile(
  resolve(misplacedFeatureRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
  "utf-8",
);
await writeFile(
  resolve(misplacedFeatureRoot, "harness/novel/import.feature"),
  `# language: zh-CN
# capability: novel.import
@novel

功能: 导入小说

  业务来源:
    - 用户提供: 导入小说需求

  意图:
    - 用户上传小说文本后，系统创建可管理的小说资产。

  边界:
    - 本能力只定义小说导入，不定义漫剧生成。

  核心承诺:
    - 有效文本必须被保存为小说。

  风险:
    - AI 可能把导入流程和后续生成流程混在一个能力里。

  待确认:
    - 无

  场景: 导入有效小说文本
    假设 用户选择有效 txt 文件
    当 用户导入小说
    那么 系统应保存小说
`,
  "utf-8",
);
await writeFile(
  resolve(broadCapabilityRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
  "utf-8",
);
await writeFile(
  resolve(broadCapabilityRoot, "harness/features/content/publish-workflow.feature"),
  `# language: zh-CN
# capability: content.publishWorkflow
@content

功能: 内容发布全链路流程

  业务来源:
    - 用户提供: 内容发布需求

  意图:
    - 用户从输入内容开始，完成校验、预览、审核、发布和归档。

  边界:
    - 本能力覆盖多个阶段，后续应拆分为单个可独立验证的业务能力。

  核心承诺:
    - 系统必须接收内容输入。
    - 系统必须校验输入合法性。
    - 系统必须生成预览。
    - 系统必须支持审核。
    - 系统必须执行发布。
    - 系统必须发送通知。
    - 系统必须归档发布记录。

  风险:
    - AI 可能把多阶段流程写成单个业务能力。

  待确认:
    - 无

  场景: 输入内容
    假设 用户准备内容
    当 用户提交内容
    那么 系统应接收内容

  场景: 校验内容
    假设 系统已接收内容
    当 系统校验内容
    那么 系统应返回校验结果

  场景: 生成预览
    假设 内容校验通过
    当 系统生成预览
    那么 用户应看到预览

  场景: 审核内容
    假设 预览已生成
    当 用户提交审核
    那么 系统应进入审核状态

  场景: 发布内容
    假设 内容审核通过
    当 用户确认发布
    那么 系统应发布内容

  场景: 发送通知
    假设 内容已发布
    当 系统处理发布结果
    那么 系统应发送通知

  场景: 归档记录
    假设 发布完成
    当 系统归档发布记录
    那么 应保存归档信息

  场景: 发布失败
    假设 发布过程中发生错误
    当 发布失败
    那么 系统应返回失败原因
`,
  "utf-8",
);
await writeFile(
  resolve(bddImplInHarnessRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
  "utf-8",
);
await writeFile(
  resolve(bddImplInHarnessRoot, "harness/bdd/cucumber.js"),
  `module.exports = {
  default: "--require harness/bdd/steps/**/*.ts harness/features/**/*.feature"
};
`,
  "utf-8",
);
await writeFile(
  resolve(bddImplInHarnessRoot, "harness/bdd/steps/order.steps.ts"),
  `import { Given } from "@cucumber/cucumber";

Given("用户提交有效订单信息", function () {});
`,
  "utf-8",
);
await writeFile(
  resolve(stepsNamedContractRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
  "utf-8",
);
await writeFile(
  resolve(stepsNamedContractRoot, "harness/capability-map.yaml"),
  `version: 1
domains:
  onboarding:
    capabilities:
      - id: onboarding.completeStep
        file: features/onboarding/steps/complete.feature
        intent: 用户完成入门步骤
flows: []
`,
  "utf-8",
);
await writeFile(
  resolve(stepsNamedContractRoot, "harness/features/onboarding/steps/complete.feature"),
  `# language: zh-CN
# capability: onboarding.completeStep
@onboarding

功能: 完成入门步骤

  业务来源:
    - 用户提供: 入门步骤完成需求

  意图:
    - 用户完成一个入门步骤后，系统记录该步骤已完成。

  边界:
    - 本能力只定义单个入门步骤完成，不定义整个入门流程。

  核心承诺:
    - 完成成功后必须记录步骤状态。

  风险:
    - AI 可能把步骤定义代码误放进 harness。

  待确认:
    - 无

  场景: 完成一个入门步骤
    假设 用户正在进行入门
    当 用户完成当前步骤
    那么 系统应记录该步骤已完成
`,
  "utf-8",
);

for (const root of [jsBddDetectRoot, javaBddDetectRoot, pythonBddDetectRoot]) {
  await writeFile(
    resolve(root, "harness.yaml"),
    `version: 1
spec_dir: harness
`,
    "utf-8",
  );
}
await writeFile(
  resolve(jsBddDetectRoot, "package.json"),
  JSON.stringify({ devDependencies: { "@cucumber/cucumber": "^11.0.0" } }),
  "utf-8",
);
await writeFile(
  resolve(javaBddDetectRoot, "pom.xml"),
  `<project><dependencies><dependency><groupId>io.cucumber</groupId><artifactId>cucumber-java</artifactId></dependency></dependencies></project>`,
  "utf-8",
);
await writeFile(
  resolve(pythonBddDetectRoot, "pyproject.toml"),
  `[project]
dependencies = ["behave", "pytest-bdd"]
`,
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

send({
  jsonrpc: "2.0",
  id: 66,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: nonBusinessLanguageRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 67,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: jsBddDetectRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 68,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: javaBddDetectRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 69,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: pythonBddDetectRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 70,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: misplacedFeatureRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 71,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: broadCapabilityRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 72,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: bddImplInHarnessRoot },
  },
});
await wait(500);

send({
  jsonrpc: "2.0",
  id: 73,
  method: "tools/call",
  params: {
    name: "doctor",
    arguments: { raw: true, path: stepsNamedContractRoot },
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
    (c: any) => c.id === "bdd.report.format" && c.level === "fail",
  ),
  "unsupported report should fail report format check",
);

const nonBusinessLanguage = parse(66);
console.log(
  "=== doctor raw non-business language ===\n" +
    text(66).slice(0, 1000) +
    "...\n",
);
assert(nonBusinessLanguage?.status === "fail", "constraint files missing language should make doctor fail because check cannot parse them");
assert(
  nonBusinessLanguage?.checks?.some(
    (c: any) =>
      c.id === "harness_language.non_business_zh_cn" &&
      c.level === "warn" &&
      String(c.detail ?? "").includes("harness/_charter/security.feature") &&
      String(c.detail ?? "").includes("harness/constraints/no-debug.feature") &&
      String(c.detail ?? "").includes("harness/flows/checkout.feature"),
  ),
  "doctor should warn when charter/constraints/flows miss # language: zh-CN",
);

const jsBddDetect = parse(67);
console.log(
  "=== doctor raw js bdd detect ===\n" +
    text(67).slice(0, 800) +
    "...\n",
);
assert(
  jsBddDetect?.checks?.some(
    (c: any) =>
      c.id === "bdd.configured" &&
      c.level === "warn" &&
      String(c.detail ?? "").includes("cucumber-js"),
  ),
  "doctor should recommend cucumber-js when package.json includes @cucumber/cucumber",
);

const javaBddDetect = parse(68);
console.log(
  "=== doctor raw java bdd detect ===\n" +
    text(68).slice(0, 800) +
    "...\n",
);
assert(
  javaBddDetect?.checks?.some(
    (c: any) =>
      c.id === "bdd.configured" &&
      c.level === "warn" &&
      String(c.detail ?? "").includes("cucumber-jvm"),
  ),
  "doctor should recommend cucumber-jvm when pom.xml includes cucumber",
);

const pythonBddDetect = parse(69);
console.log(
  "=== doctor raw python bdd detect ===\n" +
    text(69).slice(0, 800) +
    "...\n",
);
assert(
  pythonBddDetect?.checks?.some(
    (c: any) =>
      c.id === "bdd.configured" &&
      c.level === "warn" &&
      String(c.detail ?? "").includes("behave") &&
      String(c.detail ?? "").includes("pytest-bdd"),
  ),
  "doctor should recommend Python BDD runners from pyproject.toml",
);

const misplacedFeature = parse(70);
console.log(
  "=== doctor raw misplaced feature ===\n" +
    text(70).slice(0, 1000) +
    "...\n",
);
assert(
  misplacedFeature?.checks?.some(
    (c: any) =>
      c.id === "capabilities.layout" &&
      c.level === "warn" &&
      String(c.detail ?? "").includes("harness/novel/import.feature") &&
      String(c.detail ?? "").includes("harness/features/novel/import.feature"),
  ),
  "doctor should warn when capability feature files are outside harness/features",
);

const broadCapability = parse(71);
console.log(
  "=== doctor raw broad capability ===\n" +
    text(71).slice(0, 1200) +
    "...\n",
);
assert(
  broadCapability?.checks?.some(
    (c: any) =>
      c.id === "capabilities.boundary" &&
      c.level === "warn" &&
      String(c.detail ?? "").includes("harness/features/content/publish-workflow.feature") &&
      String(c.detail ?? "").includes("scenario_count") &&
      String(c.detail ?? "").includes("core_promises") &&
      String(c.detail ?? "").includes("flow_like_title"),
  ),
  "doctor should warn when a capability is structurally too broad",
);

const bddImplInHarness = parse(72);
console.log(
  "=== doctor raw bdd implementation in harness ===\n" +
    text(72).slice(0, 1200) +
    "...\n",
);
assert(
  bddImplInHarness?.checks?.some(
    (c: any) =>
      c.id === "harness_contract.no_bdd_implementation" &&
      c.level === "fail" &&
      String(c.detail ?? "").includes("harness/bdd/cucumber.js") &&
      String(c.detail ?? "").includes("harness/bdd/steps/order.steps.ts"),
  ),
  "doctor should fail when BDD step definitions or runner config are under harness",
);

const stepsNamedContract = parse(73);
console.log(
  "=== doctor raw steps-named feature contract ===\n" +
    text(73).slice(0, 1200) +
    "...\n",
);
assert(
  stepsNamedContract?.checks?.some(
    (c: any) =>
      c.id === "harness_contract.no_bdd_implementation" &&
      c.level === "pass",
  ),
  "doctor should not flag .feature contract files under a business directory named steps",
);
assert(
  !String(
    stepsNamedContract?.checks?.find(
      (c: any) => c.id === "harness_contract.no_bdd_implementation",
    )?.detail ?? "",
  ).includes("harness/features/onboarding/steps/complete.feature"),
  "doctor should not list business .feature contracts as BDD implementation artifacts",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\n✅ All Day 9 doctor tests passed");
} else {
  process.exit(1);
}
