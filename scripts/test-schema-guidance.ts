#!/usr/bin/env bun
/**
 * schema guidance tests — strict schemas must return actionable repair paths.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCapabilityMapContent } from "../src/capability_map.ts";
import { loadConfig } from "../src/config.ts";
import { executeCheck } from "../src/tools/check.ts";
import { executeContext } from "../src/tools/context.ts";
import { executeContract } from "../src/tools/contract.ts";
import { executeHelp } from "../src/tools/help.ts";
import { executeLint } from "../src/tools/lint.ts";
import { executeRead } from "../src/tools/read.ts";
import { executeVerify } from "../src/tools/verify.ts";

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const invalidFlatMap = `version: 1
ailearning.practice:
  file: features/api/ailearning/practice.feature
  entrypoint: AnswerUserApiService.start
  intent: 智能学习答题
`;

const invalidCapabilitiesMap = `version: 1
capabilities:
  ailearning.practice:
    file: features/api/ailearning/practice.feature
    entrypoint: AnswerUserApiService.start
    intent: 智能学习答题
`;

const validMap = `version: 1
domains:
  ailearning:
    capabilities:
      - id: api.ailearning.practice
        file: features/api/ailearning/practice.feature
        entrypoint: AnswerUserApiService.start
        intent: 智能学习答题
flows:
  - id: e2e.ailearning.practiceFlow
    file: flows/e2e/ailearning/practice.feature
    uses:
      - api.ailearning.practice
`;

const validFeature = `# language: zh-CN
# capability: api.ailearning.practice
# entrypoint: AnswerUserApiService.start
@ailearning @practice

功能: 智能学习答题

  意图:
    - 学生开始练习后,系统创建练习会话并返回第一题。

  边界:
    - 只定义开始练习,不定义交卷后的统计分析。

  待确认:
    - 无

  规则: 学生可以开始练习
    # sources:
    #   current: sources/2026-05-08-code-inference-practice.md#学生可以开始练习
    #   timeline:
    #     - sources/2026-05-08-code-inference-practice.md#学生可以开始练习

    场景: 学生开始有效练习
      假设 学生已登录
      当 学生开始练习
      那么 应创建练习会话
`;

const flowFeature = `# language: zh-CN
@ailearning @flow
功能: 智能学习答题流程

  规则: 学生完成练习流程

    场景: 学生完成一次练习
      假设 学生已登录
      当 学生完成练习
      那么 应记录练习结果
`;

const flatParsed = parseCapabilityMapContent(invalidFlatMap);
console.log("=== flat map parse ===\n" + JSON.stringify(flatParsed, null, 2) + "\n");
assert(!flatParsed.ok, "flat capability-map should fail");
if (!flatParsed.ok) {
  assert(flatParsed.error.includes("正确格式"), "flat map error should include correct schema guidance");
  assert(flatParsed.error.includes("domains:"), "flat map error should include domains example");
  assert(flatParsed.error.includes("Next action"), "flat map error should include next action");
}

const capabilitiesParsed = parseCapabilityMapContent(invalidCapabilitiesMap);
console.log("=== capabilities map parse ===\n" + JSON.stringify(capabilitiesParsed, null, 2) + "\n");
assert(!capabilitiesParsed.ok, "capabilities object map should fail");
if (!capabilitiesParsed.ok) {
  assert(capabilitiesParsed.error.includes("正确格式"), "capabilities map error should include correct schema guidance");
  assert(capabilitiesParsed.error.includes("顶层字段"), "capabilities map error should list top-level keys");
}

const guide = await executeHelp({ topic: "capability-map" });
console.log("=== capability-map guide ===\n" + guide + "\n");
assert(guide.includes("domains:"), "guide capability-map should document domains schema");
assert(guide.includes("contract({"), "guide capability-map should show repair tool call");

const configGuide = await executeHelp({ topic: "harness-yaml" });
console.log("=== harness-yaml guide ===\n" + configGuide + "\n");
assert(configGuide.includes("harness.yaml"), "guide harness-yaml should document config file");
assert(configGuide.includes("bdd:"), "guide harness-yaml should show bdd schema");
assert(configGuide.includes("Next action"), "guide harness-yaml should include next action");

const noConfigRoot = await mkdtemp(`${tmpdir()}/harness-mcp-no-config-guidance-`);
const noConfigContext = await executeContext({ path: noConfigRoot });
console.log("=== no config project_context ===\n" + noConfigContext + "\n");
assert(noConfigContext.includes("正确格式"), "project_context no-config should include harness.yaml schema guidance");

const noConfigCheck = await executeCheck({ path: noConfigRoot, dryRun: true });
console.log("=== no config check ===\n" + noConfigCheck + "\n");
assert(noConfigCheck.includes("正确格式"), "check no-config should include harness.yaml schema guidance");

const noConfigRead = await executeRead({ path: noConfigRoot });
console.log("=== no config read_contract ===\n" + noConfigRead + "\n");
assert(noConfigRead.includes("正确格式"), "read_contract no-config should include harness.yaml schema guidance");

const noConfigVerify = await executeVerify({ path: noConfigRoot, dryRun: true });
console.log("=== no config verify ===\n" + noConfigVerify + "\n");
assert(noConfigVerify.includes("正确格式"), "verify no-config should include harness.yaml schema guidance");

const noConfigLint = await executeLint({ path: noConfigRoot, dryRun: true });
console.log("=== no config lint ===\n" + noConfigLint + "\n");
assert(noConfigLint.includes("正确格式"), "lint no-config should include harness.yaml schema guidance");

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-schema-guidance-`);
await mkdir(resolve(tmpRoot, "harness/features/api/ailearning"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/flows/e2e/ailearning"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/sources"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
targets:
  - api
  - e2e
bdd:
  runner: custom
  cmd: "true {feature}"
  workdir: "."
  feature_arg_pattern: "{feature}"
  report:
    format: cucumber-json
    path: target/cucumber.json
`,
);
await writeFile(resolve(tmpRoot, "harness/capability-map.yaml"), invalidFlatMap);
await writeFile(
  resolve(tmpRoot, "harness/sources/2026-05-08-code-inference-practice.md"),
  `# 智能学习答题代码推断

## 学生可以开始练习

从 AnswerUserApiService.start 推断学生开始练习后创建练习会话。
`,
);
await writeFile(resolve(tmpRoot, "harness/features/api/ailearning/practice.feature"), validFeature);
await writeFile(resolve(tmpRoot, "harness/flows/e2e/ailearning/practice.feature"), flowFeature);

const contextText = await executeContext({ path: tmpRoot });
console.log("=== project_context invalid map ===\n" + contextText + "\n");
assert(contextText.includes("正确格式"), "project_context should include capability-map schema guidance");
assert(contextText.includes("Next action"), "project_context should include next action for invalid map");

const checkText = await executeCheck({ path: tmpRoot, dryRun: true });
console.log("=== check invalid map ===\n" + checkText + "\n");
assert(checkText.includes("正确格式"), "check should include capability-map schema guidance");
assert(checkText.includes("guide({ topic: \"capability-map\" })"), "check should tell AI to call guide");

const readText = await executeRead({ path: tmpRoot });
console.log("=== read_contract invalid map ===\n" + readText + "\n");
assert(readText.includes("capability-map.yaml"), "read_contract should surface invalid map");
assert(readText.includes("Next action"), "read_contract should include repair action");

const verifyText = await executeVerify({
  path: tmpRoot,
  target_type: "flow",
  target: "e2e.ailearning.practiceFlow",
  dryRun: true,
});
console.log("=== verify invalid map flow id ===\n" + verifyText + "\n");
assert(verifyText.includes("capability-map.yaml"), "verify flow by id should surface invalid map");
assert(verifyText.includes("Next action"), "verify flow by id should include repair action");

const repairedRaw = await executeContract({
  path: tmpRoot,
  kind: "capability",
  id: "api.ailearning.practice",
  file: "features/api/ailearning/practice.feature",
  content: validFeature,
  map_content: validMap,
  raw: true,
});
console.log("=== contract repairs invalid map ===\n" + repairedRaw + "\n");
const repaired = JSON.parse(repairedRaw);
assert(repaired.ok === true, "contract with valid map_content should repair existing invalid map");

const loadedAfterRepair = await executeCheck({ path: tmpRoot, dryRun: true, raw: true });
const checkAfterRepair = JSON.parse(loadedAfterRepair);
assert(
  checkAfterRepair.static_checks.some((check: any) => check.id === "capability_map.alignment" && check.level === "pass"),
  "check should pass map alignment after contract repair",
);

const invalidConfigRoot = await mkdtemp(`${tmpdir()}/harness-mcp-config-guidance-`);
await writeFile(
  resolve(invalidConfigRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
targets:
  - api
unknown_key: true
`,
);

try {
  await loadConfig(invalidConfigRoot);
  assert(false, "invalid harness.yaml should throw");
} catch (error) {
  const message = (error as Error).message;
  console.log("=== harness.yaml invalid config ===\n" + message + "\n");
  assert(message.includes("正确格式"), "harness.yaml error should include correct config guidance");
  assert(message.includes("version: 1"), "harness.yaml error should include minimal example");
  assert(message.includes("Next action"), "harness.yaml error should include next action");
}

await rm(tmpRoot, { recursive: true, force: true });
await rm(invalidConfigRoot, { recursive: true, force: true });
await rm(noConfigRoot, { recursive: true, force: true });

if (pass) console.log("\nAll schema guidance tests passed");
else process.exit(1);
