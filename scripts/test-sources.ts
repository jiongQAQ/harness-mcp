#!/usr/bin/env bun
/**
 * Source traceability tests: .harness/sources documents + optional source-map.yaml.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeCheck } from "../src/tools/check.ts";
import { executeContract } from "../src/tools/contract.ts";
import { executeContext } from "../src/tools/context.ts";
import { executeHelp } from "../src/tools/help.ts";
import { executeReadSource } from "../src/tools/read_source.ts";

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-sources-`);
await mkdir(resolve(tmpRoot, ".harness/sources"), { recursive: true });
await mkdir(resolve(tmpRoot, ".harness/features/api/order"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: .harness
charter_dir: .harness/_charter
targets:
  - api
`,
);
await writeFile(
  resolve(tmpRoot, ".harness/sources/2026-05-08-code-inference-order-create.md"),
  `# 创建订单规则代码推断

## 优惠计算失败

从 OrderService#create 推断: 优惠失败时不创建订单,不锁库存。
`,
);
await writeFile(
  resolve(tmpRoot, ".harness/sources/2026-05-10-manual-confirmation-order-create.md"),
  `# 创建订单人工确认

## 优惠失败处理

产品确认: 优惠失败时不创建订单,不锁库存。
`,
);
await writeFile(
  resolve(tmpRoot, ".harness/sources/invalid-name.md"),
  `# 错误命名来源
`,
);

const mapContent = `version: 1
domains:
  order:
    capabilities:
      - id: api.order.create
        file: features/api/order/create.feature
        entrypoint: OrderController#create
        intent: 创建订单并锁定库存
flows: []
`;

const validSourceMap = `version: 1
capabilities:
  api.order.create:
    current: sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理
    timeline:
      - sources/2026-05-08-code-inference-order-create.md#优惠计算失败
      - sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理
    rules:
      优惠计算失败时不创建订单:
        current: sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理
        timeline:
          - sources/2026-05-08-code-inference-order-create.md#优惠计算失败
          - sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理
`;

const feature = `# language: zh-CN
# capability: api.order.create
# entrypoint: OrderController#create
@order @create

功能: 创建订单

  意图:
    - 客户提交有效购买请求后,系统创建待支付订单并锁定库存。

  边界:
    - 本能力只定义订单创建,不定义支付、发货和售后。

  待确认:
    - 库存预占超时时间由其他能力定义。

  规则: 优惠计算失败时不创建订单
    场景: 优惠服务返回失败
      假设 客户已登录
      当 客户使用不可计算的优惠下单
      那么 不应创建订单
      而且 不应锁定库存
`;

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const createdRaw = await executeContract({
  path: tmpRoot,
  kind: "capability",
  id: "api.order.create",
  file: "features/api/order/create.feature",
  content: feature,
  map_content: mapContent,
  raw: true,
});
const created = JSON.parse(createdRaw);
console.log("=== contract without inline sources ===\n" + createdRaw + "\n");
assert(created.ok === true, "contract should accept features without inline sources comments");

const featureOnDisk = await readFile(resolve(tmpRoot, ".harness/features/api/order/create.feature"), "utf-8");
assert(!featureOnDisk.includes("# sources:"), "feature should not need inline sources comments");

await writeFile(resolve(tmpRoot, ".harness/source-map.yaml"), validSourceMap);

const checkRaw = await executeCheck({ path: tmpRoot, dryRun: true, raw: true });
const check = JSON.parse(checkRaw);
console.log("=== check source map ===\n" + checkRaw + "\n");
assert(
  check.static_checks.some((item: any) =>
    item.id === "sources.files.date_name" &&
    item.level === "fail" &&
    String(item.detail).includes("invalid-name.md")
  ),
  "check should fail source files without date prefix",
);
assert(
  check.static_checks.some((item: any) => item.id === "source_map.format" && item.level === "pass"),
  "check should validate source-map.yaml when it exists",
);
assert(
  !check.static_checks.some((item: any) => String(item.id).startsWith("feature_sources.")),
  "check should not use feature inline source checks anymore",
);

const missingSourceMap = validSourceMap.replace(
  "sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理",
  "sources/2026-05-11-missing-confirmation.md#优惠失败处理",
);
await writeFile(resolve(tmpRoot, ".harness/source-map.yaml"), missingSourceMap);
const missingCheck = JSON.parse(await executeCheck({ path: tmpRoot, dryRun: true, raw: true }));
console.log("=== missing source map file ===\n" + JSON.stringify(missingCheck, null, 2) + "\n");
assert(
  missingCheck.static_checks.some((item: any) => item.id === "source_map.exists" && item.level === "fail"),
  "check should reject source-map references to missing source files",
);

const outsideTimelineSourceMap = validSourceMap.replace(
  "current: sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理",
  "current: sources/2026-05-08-code-inference-order-create.md#其他章节",
);
await writeFile(resolve(tmpRoot, ".harness/source-map.yaml"), outsideTimelineSourceMap);
const outsideTimelineCheck = JSON.parse(await executeCheck({ path: tmpRoot, dryRun: true, raw: true }));
console.log("=== source map current outside timeline ===\n" + JSON.stringify(outsideTimelineCheck, null, 2) + "\n");
assert(
  outsideTimelineCheck.static_checks.some((item: any) => item.id === "source_map.current_in_timeline" && item.level === "fail"),
  "check should require source-map current to be in timeline",
);

const reversedTimelineSourceMap = validSourceMap.replace(
  `      - sources/2026-05-08-code-inference-order-create.md#优惠计算失败
      - sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理`,
  `      - sources/2026-05-10-manual-confirmation-order-create.md#优惠失败处理
      - sources/2026-05-08-code-inference-order-create.md#优惠计算失败`,
);
await writeFile(resolve(tmpRoot, ".harness/source-map.yaml"), reversedTimelineSourceMap);
const reversedTimelineCheck = JSON.parse(await executeCheck({ path: tmpRoot, dryRun: true, raw: true }));
console.log("=== source map reversed timeline ===\n" + JSON.stringify(reversedTimelineCheck, null, 2) + "\n");
assert(
  reversedTimelineCheck.static_checks.some((item: any) => item.id === "source_map.timeline_order" && item.level === "fail"),
  "check should reject reversed source-map timeline dates",
);

const topLevelScenario = feature.replace(
  "  规则: 优惠计算失败时不创建订单",
  `  场景: 顶层场景不允许绕过规则
    假设 客户已登录
    当 客户直接创建订单
    那么 应创建待支付订单

  规则: 优惠计算失败时不创建订单`,
);
const topLevelScenarioResult = await executeContract({
  path: tmpRoot,
  kind: "capability",
  id: "api.order.create",
  file: "features/api/order/create.feature",
  content: topLevelScenario,
  map_content: mapContent,
});
console.log("=== top-level scenario ===\n" + topLevelScenarioResult + "\n");
assert(
  topLevelScenarioResult.includes("feature_quality.scenario_under_rule"),
  "contract should reject scenarios before the first Rule",
);

await writeFile(resolve(tmpRoot, ".harness/source-map.yaml"), validSourceMap);

const contextRaw = await executeContext({ path: tmpRoot, raw: true });
const context = JSON.parse(contextRaw);
console.log("=== context sources ===\n" + contextRaw + "\n");
assert(
  context.sources.some((source: any) =>
    source.file.endsWith(".harness/sources/2026-05-08-code-inference-order-create.md") &&
    source.title === "创建订单规则代码推断"
  ),
  "project_context should index sources with titles",
);

const readSourceRaw = await executeReadSource({
  path: tmpRoot,
  file: "sources/2026-05-10-manual-confirmation-order-create.md",
  raw: true,
});
const readSource = JSON.parse(readSourceRaw);
console.log("=== read source ===\n" + readSourceRaw + "\n");
assert(readSource.content.includes("产品确认"), "read_source should return source content");

const searchRaw = await executeReadSource({ path: tmpRoot, query: "优惠失败", raw: true });
const search = JSON.parse(searchRaw);
console.log("=== search source ===\n" + searchRaw + "\n");
assert(search.matches.length >= 1, "read_source query should search source content");

const sourcesGuide = await executeHelp({ topic: "sources" });
console.log("=== guide sources ===\n" + sourcesGuide + "\n");
assert(sourcesGuide.includes("source-map.yaml"), "guide should document source-map.yaml");
assert(sourcesGuide.includes("current:"), "guide should document current");
assert(sourcesGuide.includes("timeline:"), "guide should document timeline");
assert(!sourcesGuide.includes("# sources:"), "guide should not ask AI to write inline sources comments");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) console.log("\nAll sources tests passed");
else process.exit(1);
