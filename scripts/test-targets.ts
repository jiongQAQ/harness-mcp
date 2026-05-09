#!/usr/bin/env bun
/**
 * Target-based harness contract tests.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseCapabilityMapContent } from "../src/capability_map.ts";
import { loadConfig } from "../src/config.ts";
import { executeCheck } from "../src/tools/check.ts";
import { executeContract } from "../src/tools/contract.ts";
import { executeVerify } from "../src/tools/verify.ts";

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const validMap = `version: 1
domains:
  ailearning:
    capabilities:
      - id: api.ailearning.startPractice
        file: features/api/ailearning/start-practice.feature
        entrypoint: AnswerUserApiService.start
        intent: 后端创建练习会话并返回第一题
      - id: web.ailearning.startPractice
        file: features/web/ailearning/start-practice.feature
        entrypoint: /practice/start
        intent: 前端承载开始练习入口和第一题展示
flows:
  - id: e2e.ailearning.practiceSession
    file: flows/e2e/ailearning/practice-session.feature
    uses:
      - api.ailearning.startPractice
      - web.ailearning.startPractice
`;

const validFeature = (capability: string, entrypoint: string) => `# language: zh-CN
# capability: ${capability}
# entrypoint: ${entrypoint}
@ailearning

功能: 开始练习

  意图:
    - 学生进入练习后,系统进入可作答状态。

  边界:
    - 只定义开始练习,不定义提交答案。

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
      那么 应进入可作答状态
`;

const flowFeature = `# language: zh-CN
@ailearning @e2e

功能: 学生完成练习流程

  规则: 学生可以从开始练习进入作答
    # sources:
    #   current: sources/2026-05-08-code-inference-practice.md#学生可以开始练习
    #   timeline:
    #     - sources/2026-05-08-code-inference-practice.md#学生可以开始练习

    场景: 学生进入练习
      假设 学生已登录
      当 学生开始练习
      那么 页面进入作答状态
`;

const missingTargetsRoot = await mkdtemp(`${tmpdir()}/harness-mcp-targets-missing-`);
await writeFile(
  resolve(missingTargetsRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
`,
);
try {
  await loadConfig(missingTargetsRoot);
  assert(false, "harness.yaml without targets should fail");
} catch (error) {
  const message = (error as Error).message;
  console.log("=== missing targets ===\n" + message + "\n");
  assert(message.includes("targets"), "missing targets error should mention targets");
}

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-targets-`);
await mkdir(resolve(tmpRoot, "harness/sources"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
language: zh-CN
targets:
  - api
  - web
  - e2e
workspace:
  target: api
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
await writeFile(
  resolve(tmpRoot, "harness/sources/2026-05-08-code-inference-practice.md"),
  `# 智能学习答题代码推断

## 学生可以开始练习

从 AnswerUserApiService.start 推断学生开始练习后进入可作答状态。
`,
);

const parsedValid = parseCapabilityMapContent(validMap, ["api", "web", "e2e"]);
console.log("=== valid target map ===\n" + JSON.stringify(parsedValid, null, 2) + "\n");
assert(parsedValid.ok, "target-aware capability-map should parse");

const oldPathMap = validMap.replace("features/api/ailearning/start-practice.feature", "features/ailearning/start-practice.feature");
const oldPathParsed = parseCapabilityMapContent(oldPathMap, ["api", "web", "e2e"]);
console.log("=== old path map ===\n" + JSON.stringify(oldPathParsed, null, 2) + "\n");
assert(!oldPathParsed.ok, "old features/<domain> path should fail");
if (!oldPathParsed.ok) {
  assert(oldPathParsed.error.includes("features/<target>/<domain>/"), "old path error should explain target-aware feature path");
}

const badDomainMap = validMap.replace("id: api.ailearning.startPractice", "id: api.learning.startPractice");
const badDomainParsed = parseCapabilityMapContent(badDomainMap, ["api", "web", "e2e"]);
console.log("=== bad domain map ===\n" + JSON.stringify(badDomainParsed, null, 2) + "\n");
assert(!badDomainParsed.ok, "capability domain segment should match map domain");

const badTargetMap = validMap.replace("id: api.ailearning.startPractice", "id: mobile.ailearning.startPractice");
const badTargetParsed = parseCapabilityMapContent(badTargetMap, ["api", "web", "e2e"]);
console.log("=== bad target map ===\n" + JSON.stringify(badTargetParsed, null, 2) + "\n");
assert(!badTargetParsed.ok, "unknown target should fail");

const apiRaw = await executeContract({
  path: tmpRoot,
  kind: "capability",
  id: "api.ailearning.startPractice",
  file: "features/api/ailearning/start-practice.feature",
  content: validFeature("api.ailearning.startPractice", "AnswerUserApiService.start"),
  map_content: validMap,
  raw: true,
});
console.log("=== api workspace contract ===\n" + apiRaw + "\n");
const apiCreated = JSON.parse(apiRaw);
assert(apiCreated.ok === true, "workspace target api should allow api capability");

const webResult = await executeContract({
  path: tmpRoot,
  kind: "capability",
  id: "web.ailearning.startPractice",
  file: "features/web/ailearning/start-practice.feature",
  content: validFeature("web.ailearning.startPractice", "/practice/start"),
  map_content: validMap,
});
console.log("=== web blocked by workspace ===\n" + webResult + "\n");
assert(webResult.includes("workspace.target"), "workspace target api should block web contract writes");

await writeFile(resolve(tmpRoot, "harness/capability-map.yaml"), validMap);
await mkdir(resolve(tmpRoot, "harness/features/web/ailearning"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/flows/e2e/ailearning"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness/features/web/ailearning/start-practice.feature"),
  validFeature("web.ailearning.startPractice", "/practice/start"),
);
await writeFile(resolve(tmpRoot, "harness/flows/e2e/ailearning/practice-session.feature"), flowFeature);

const checkRaw = await executeCheck({ path: tmpRoot, dryRun: true, raw: true });
console.log("=== target check ===\n" + checkRaw + "\n");
const check = JSON.parse(checkRaw);
assert(
  check.static_checks.some((item: any) => item.id === "capability_map.alignment" && item.level === "pass"),
  "target-aware map alignment should pass",
);

const verifyRaw = await executeVerify({
  path: tmpRoot,
  target_type: "flow",
  target: "e2e.ailearning.practiceSession",
  dryRun: true,
  raw: true,
});
console.log("=== e2e flow dry run ===\n" + verifyRaw + "\n");
const verify = JSON.parse(verifyRaw);
assert(
  String(verify.targets?.[0]?.file).endsWith("harness/flows/e2e/ailearning/practice-session.feature"),
  "verify should resolve target-aware e2e flow by id",
);

await rm(tmpRoot, { recursive: true, force: true });
await rm(missingTargetsRoot, { recursive: true, force: true });

if (pass) console.log("\nAll target tests passed");
else process.exit(1);
