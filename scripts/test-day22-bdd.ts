#!/usr/bin/env bun
/**
 * Day 22 test — BDD .feature execution contract.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, ConfigError } from "../src/config.ts";
import { executeFlow } from "../src/tools/flow.ts";
import { executeVerify } from "../src/tools/verify.ts";

const repoRoot = resolve(import.meta.dir, "..");
const fixtureRoot = resolve(repoRoot, "examples/sel-service-yaml");
const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-bdd-`);
await cp(fixtureRoot, tmpRoot, { recursive: true });
await mkdir(resolve(tmpRoot, "harness/flows"), { recursive: true });
await mkdir(resolve(tmpRoot, "runner/target"), { recursive: true });

await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter

bdd:
  runner: cucumber-js
  cmd: 'cp "$REPORT_SRC" target/bdd-cucumber.json && echo'
  workdir: "runner"
  feature_arg_pattern: '"{feature}"'
  name_filter_pattern: '"bdd-name={name}"'
  report:
    format: cucumber-json
    path: target/bdd-cucumber.json
  timeout_ms: 10000

ai_hints: ""
`,
  "utf-8",
);

await writeFile(
  resolve(tmpRoot, "harness/flows/checkout.feature"),
  `# language: zh-CN
@flow @checkout
功能: 用户完成下单

  场景: 新用户选择商品并完成支付
    假设 用户已打开商品详情页
    当 用户加入购物车
    而且 用户提交订单
    而且 用户完成支付
    那么 应看到订单编号
`,
  "utf-8",
);

const getByUidReport = JSON.stringify([
  {
    uri: "harness/ai-learning/subject-literacy/getByUid.feature",
    name: "按知识图谱节点UID查询学科素养",
    elements: [
      {
        type: "scenario",
        name: "uid 下挂多条 — 全部返回",
        line: 24,
        steps: [{ name: "data 应包含 2 条记录", result: { status: "passed" } }],
      },
      {
        type: "scenario",
        name: "uid 下无记录 — 返回空列表",
        line: 32,
        steps: [{ name: "data 应为空列表", result: { status: "passed" } }],
      },
    ],
  },
]);

const wrongCapabilityReport = JSON.stringify([
  {
    uri: "harness/ai-learning/subject-literacy/deleteById.feature",
    name: "按主键ID软删学科素养",
    elements: [
      {
        type: "scenario",
        name: "正常删除",
        line: 23,
        steps: [{ name: "数据库中 deleted 应为 1", result: { status: "passed" } }],
      },
    ],
  },
]);

const flowReport = JSON.stringify([
  {
    uri: "harness/flows/checkout.feature",
    name: "用户完成下单",
    elements: [
      {
        type: "scenario",
        name: "新用户选择商品并完成支付",
        line: 5,
        steps: [{ name: "应看到订单编号", result: { status: "passed" } }],
      },
    ],
  },
]);

const getByUidReportPath = resolve(tmpRoot, "_getByUid.json");
const wrongCapabilityReportPath = resolve(tmpRoot, "_wrong-capability.json");
const flowReportPath = resolve(tmpRoot, "_flow.json");
await writeFile(getByUidReportPath, getByUidReport, "utf-8");
await writeFile(wrongCapabilityReportPath, wrongCapabilityReport, "utf-8");
await writeFile(flowReportPath, flowReport, "utf-8");

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const loaded = await loadConfig(tmpRoot);
assert(loaded?.config.bdd?.runner === "cucumber-js", "config should load top-level bdd runner");
assert(
  loaded?.config.bdd?.feature_arg_pattern === '"{feature}"',
  "config should load feature_arg_pattern",
);

const legacyRoot = resolve(tmpRoot, "legacy");
await mkdir(legacyRoot, { recursive: true });
await writeFile(
  resolve(legacyRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
verify:
  cmd: "npm test"
`,
  "utf-8",
);
let legacyRejected = false;
try {
  await loadConfig(legacyRoot);
} catch (e) {
  legacyRejected = e instanceof ConfigError;
}
assert(legacyRejected, "legacy verify.cmd config should be rejected");

process.env.REPORT_SRC = getByUidReportPath;
const verifyPass = await executeVerify({
  path: tmpRoot,
  capability: "getByUid",
  include_diff: false,
  raw: true,
});
const verifyPassRaw = JSON.parse(verifyPass);
console.log("=== verify bdd pass ===\n" + verifyPass + "\n");
assert(
  verifyPassRaw.cmd.includes('"../harness/ai-learning/subject-literacy/getByUid.feature"'),
  "verify should execute the selected capability feature path relative to bdd.workdir",
);
assert(
  verifyPassRaw.cmd.includes('"bdd-name=subject-literacy.getByUid"'),
  "verify should expand name_filter_pattern with capability name",
);
assert(verifyPassRaw.bdd_coverage?.ok === true, "verify should pass BDD coverage");
assert(
  verifyPassRaw.next_required_action === "Step Evidence Review",
  "verify PASS should require Step Evidence Review next",
);

process.env.REPORT_SRC = wrongCapabilityReportPath;
const verifyWrong = await executeVerify({
  path: tmpRoot,
  capability: "getByUid",
  include_diff: false,
});
console.log("=== verify bdd wrong report ===\n" + verifyWrong + "\n");
assert(
  verifyWrong.includes("BDD Coverage: FAIL"),
  "verify should fail when report does not cover selected capability feature",
);
assert(
  verifyWrong.includes("subject-literacy.getByUid"),
  "verify coverage failure should name selected capability",
);
assert(
  !verifyWrong.includes("Next required action: Step Evidence Review"),
  "verify coverage failure should not require Step Evidence Review as a pass action",
);

process.env.REPORT_SRC = flowReportPath;
const flowPass = await executeFlow({
  path: tmpRoot,
  name: "下单",
  dryRun: false,
  raw: true,
});
const flowPassRaw = JSON.parse(flowPass);
console.log("=== flow bdd pass ===\n" + flowPass + "\n");
assert(
  flowPassRaw.cmd.includes('"../harness/flows/checkout.feature"'),
  "flow should execute the selected flow feature path relative to bdd.workdir",
);
assert(
  flowPassRaw.cmd.includes('"bdd-name=用户完成下单"'),
  "flow should expand name_filter_pattern with flow title",
);
assert(flowPassRaw.bdd_coverage?.ok === true, "flow should pass BDD coverage");
assert(
  flowPassRaw.next_required_action === "Step Evidence Review",
  "flow PASS should require Step Evidence Review next",
);

process.env.REPORT_SRC = getByUidReportPath;
const flowWrong = await executeFlow({
  path: tmpRoot,
  name: "下单",
  dryRun: false,
});
console.log("=== flow bdd wrong report ===\n" + flowWrong + "\n");
assert(
  flowWrong.includes("BDD Coverage: FAIL"),
  "flow should fail when report does not cover selected flow feature",
);
assert(flowWrong.includes("用户完成下单"), "flow coverage failure should name selected flow");
assert(
  !flowWrong.includes("Next required action: Step Evidence Review"),
  "flow coverage failure should not require Step Evidence Review as a pass action",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) {
  console.log("\nAll Day 22 BDD tests passed");
} else {
  process.exit(1);
}
