#!/usr/bin/env bun
/**
 * Init and operational guide tests.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeDiscover } from "../src/tools/discover.ts";
import { executeHelp } from "../src/tools/help.ts";
import { executeInit } from "../src/tools/init.ts";

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const guideNewProject = await executeHelp({ topic: "new-project" });
console.log("=== guide new-project ===\n" + guideNewProject + "\n");
assert(guideNewProject.includes("什么时候用"), "new-project guide should be task-oriented");
assert(guideNewProject.includes("init"), "new-project guide should point to init");
assert(guideNewProject.includes("下一步"), "new-project guide should include next action");

const guideOverview = await executeHelp({ topic: "overview" });
console.log("=== guide overview ===\n" + guideOverview + "\n");
assert(guideOverview.includes("最短路径"), "overview should give AI a shortest path");

const mapGuide = await executeHelp({ topic: "capability-map" });
console.log("=== guide capability-map ===\n" + mapGuide + "\n");
assert(mapGuide.includes("不要盲猜"), "capability-map guide should forbid schema guessing");
assert(mapGuide.includes("map_content"), "capability-map guide should explain map_content repair");

const guideLegacy = await executeHelp({ topic: "legacy-project" });
console.log("=== guide legacy-project ===\n" + guideLegacy + "\n");
assert(guideLegacy.includes("不要直接写 feature"), "legacy guide should stop direct feature writing");
assert(guideLegacy.includes("discover"), "legacy guide should point to discover");

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-init-`);
const initRaw = await executeInit({
  path: tmpRoot,
  mode: "workspace",
  targets: ["api", "web", "e2e"],
  target: "api",
  raw: true,
});
console.log("=== init workspace ===\n" + initRaw + "\n");
const init = JSON.parse(initRaw);
assert(init.ok === true, "init should succeed");
assert(init.next_required_action === "project_context", "init should point to project_context");

const harnessYaml = await readFile(resolve(tmpRoot, "harness.yaml"), "utf-8");
assert(harnessYaml.includes("targets:"), "init should write targets");
assert(harnessYaml.includes("workspace:"), "workspace mode should write workspace target");
assert(harnessYaml.includes("target: api"), "workspace target should be api");
assert(harnessYaml.includes("spec_dir: .harness"), "init should default spec_dir to .harness");
assert(harnessYaml.includes("charter_dir: .harness/_charter"), "init should default charter_dir to .harness/_charter");
assert(existsSync(resolve(tmpRoot, ".harness/_charter/architecture.md")), "init should create architecture charter");
assert(existsSync(resolve(tmpRoot, ".harness/capability-map.yaml")), "init should create capability map");
assert(existsSync(resolve(tmpRoot, ".harness/source-map.yaml")), "init should create source map");
assert(existsSync(resolve(tmpRoot, ".harness/lint/rules.yaml")), "init should create empty lint rules file");

const map = await readFile(resolve(tmpRoot, ".harness/capability-map.yaml"), "utf-8");
assert(map.includes("domains: {}"), "empty capability map should be explicit");

const sourceMap = await readFile(resolve(tmpRoot, ".harness/source-map.yaml"), "utf-8");
assert(sourceMap.includes("capabilities: {}"), "empty source map should be explicit");

const lintRules = await readFile(resolve(tmpRoot, ".harness/lint/rules.yaml"), "utf-8");
assert(lintRules.includes("rules: []"), "init should not create opinionated code lint rules");
assert(!lintRules.includes("try"), "init should not seed no-try-catch or other project-specific rules");

const existingRoot = await mkdtemp(`${tmpdir()}/harness-mcp-init-existing-`);
await writeFile(
  resolve(existingRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
targets:
  - api
`,
);
const existingInitRaw = await executeInit({
  path: existingRoot,
  mode: "legacy",
  raw: true,
});
console.log("=== init existing config ===\n" + existingInitRaw + "\n");
const existingInit = JSON.parse(existingInitRaw);
assert(existingInit.ok === true, "init should succeed with existing harness.yaml");
assert(
  existingInit.files.some((file: any) => file.file === "harness.yaml" && file.action === "skipped"),
  "init should skip existing harness.yaml without overwrite",
);
assert(existsSync(resolve(existingRoot, "harness/source-map.yaml")), "init should add new files under existing spec_dir");
assert(!existsSync(resolve(existingRoot, ".harness/source-map.yaml")), "init should not create ignored .harness files for existing spec_dir");

const shallowStateRaw = await executeDiscover({
  source: "code",
  goal: "学生开始练习",
  capability: "api.ailearning.startPractice",
  entrypoints: ["PracticeController#start"],
  call_chain: ["PracticeService#start"],
  business_rules: [
    "学生已登录时允许开始练习。",
    "学生未登录时拒绝开始练习。",
  ],
  examples: [
    "学生开始练习时返回第一题。",
    "学生未登录时拒绝开始练习。",
  ],
  questions: ["题目选择规则是否需要按掌握度过滤？"],
  evidence: [{ source: "code", detail: "PracticeService#start" }],
  raw: true,
});
console.log("=== discover missing lifecycle ===\n" + shallowStateRaw + "\n");
const shallowState = JSON.parse(shallowStateRaw);
assert(shallowState.ok === false, "discovery without state/effect/boundary depth should fail");
assert(
  shallowState.checks.some((check: any) => check.id === "discovery.rules.state_change" && check.level === "fail"),
  "discover should fail when state changes are missing",
);
assert(
  shallowState.checks.some((check: any) => check.id === "discovery.rules.side_effects" && check.level === "fail"),
  "discover should fail when side effects or no-side-effect guarantees are missing",
);

const richRaw = await executeDiscover({
  source: "mixed",
  goal: "学生开始练习",
  capability: "api.ailearning.startPractice",
  entrypoints: ["PracticeController#start"],
  call_chain: [
    "PracticeController#start",
    "PracticeService#start",
    "QuestionSelector#nextQuestion",
    "PracticeSessionRepository#save",
  ],
  business_rules: [
    "学生已登录且练习未结束时创建 IN_PROGRESS 练习会话。",
    "系统按当前知识点和掌握度过滤可练习题目并返回第一题。",
    "创建练习会话后必须记录开始时间和题目快照。",
    "没有可练习题目时拒绝开始练习且不创建会话。",
  ],
  examples: [
    "有可练习题目时创建 IN_PROGRESS 会话并返回第一题。",
    "没有可练习题目时拒绝开始且不创建会话。",
    "学生未登录时拒绝开始练习。",
  ],
  questions: ["会话超时时间由哪个规则定义？"],
  evidence: [
    { source: "code", detail: "PracticeService#start" },
    { source: "code", detail: "PracticeSessionRepository#save" },
    { source: "human", detail: "题目快照需要保留用于后续批改" },
  ],
  raw: true,
});
console.log("=== discover lifecycle rich ===\n" + richRaw + "\n");
const rich = JSON.parse(richRaw);
assert(rich.ok === true, "rich lifecycle discovery should pass");
assert(
  rich.checks.some((check: any) => check.id === "discovery.rules.state_change" && check.level === "pass"),
  "rich discovery should pass state change check",
);
assert(
  rich.checks.some((check: any) => check.id === "discovery.rules.side_effects" && check.level === "pass"),
  "rich discovery should pass side effect check",
);

await rm(tmpRoot, { recursive: true, force: true });
await rm(existingRoot, { recursive: true, force: true });

if (pass) console.log("\nAll init/guide/discover tests passed");
else process.exit(1);
