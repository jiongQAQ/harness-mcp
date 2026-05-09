#!/usr/bin/env bun
/**
 * verify tool BDD report integrity tests.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeVerify } from "../src/tools/verify.ts";

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-verify-`);
await mkdir(resolve(tmpRoot, "harness/features/api/order"), { recursive: true });
await mkdir(resolve(tmpRoot, "target"), { recursive: true });

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
  cmd: 'true'
  workdir: '.'
  feature_arg_pattern: '{feature}'
  report:
    format: cucumber-json
    path: target/bdd-cucumber.json
`,
);

await writeFile(
  resolve(tmpRoot, "harness/features/api/order/create.feature"),
  `# language: zh-CN
# capability: api.order.create
# entrypoint: OrderController#create
@order
功能: 创建订单

  业务来源:
    - 代码推断: OrderController#create

  意图:
    - 客户创建订单。

  边界:
    - 只定义订单创建。

  待确认:
    - 无

  规则: 有库存商品可以创建订单

    场景: 客户购买有库存商品
      假设 客户已登录
      当 客户购买 2 件商品 "sku-001"
      那么 应创建一笔待支付订单
`,
);
await mkdir(resolve(tmpRoot, "harness/flows/e2e/order"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness/capability-map.yaml"),
  `version: 1
domains:
  order:
    capabilities:
      - id: api.order.create
        file: features/api/order/create.feature
        entrypoint: OrderController#create
        intent: 创建订单
flows:
  - id: e2e.order.customerPurchase
    file: flows/e2e/order/customer-purchase.feature
    uses:
      - api.order.create
`,
);
await writeFile(
  resolve(tmpRoot, "harness/flows/e2e/order/customer-purchase.feature"),
  `# language: zh-CN
@flow
功能: 客户购买旅程

  场景: 客户创建订单
    假设 客户已登录
    当 客户购买有库存商品
    那么 应创建一笔待支付订单
`,
);

const passedReport = JSON.stringify([
  {
    uri: "harness/features/api/order/create.feature",
    name: "创建订单",
    elements: [
      {
        type: "scenario",
        name: "客户购买有库存商品",
        steps: [{ name: "应创建一笔待支付订单", result: { status: "passed" } }],
      },
    ],
  },
]);
await writeFile(resolve(tmpRoot, "target/bdd-cucumber.json"), passedReport, "utf-8");

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const staleRaw = await executeVerify({
  path: tmpRoot,
  target_type: "capability",
  target: "api.order.create",
  raw: true,
});
const stale = JSON.parse(staleRaw);
console.log("=== stale report ===\n" + staleRaw + "\n");
assert(stale.report_fresh === false, "verify should detect stale report");
assert(stale.bdd_coverage.ok === false, "stale report should fail coverage");
assert(stale.next_required_action === null, "stale report should not require Step Evidence Review");

const skippedReportPath = resolve(tmpRoot, "_skipped.json");
await writeFile(
  skippedReportPath,
  JSON.stringify([
    {
      uri: "harness/features/api/order/create.feature",
      name: "创建订单",
      elements: [
        {
          type: "scenario",
          name: "客户购买有库存商品",
          steps: [{ name: "应创建一笔待支付订单", result: { status: "skipped" } }],
        },
      ],
    },
  ]),
  "utf-8",
);
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
  cmd: 'cp "$REPORT_SRC"'
  workdir: '.'
  feature_arg_pattern: 'target/bdd-cucumber.json'
  report:
    format: cucumber-json
    path: target/bdd-cucumber.json
`,
);
process.env.REPORT_SRC = skippedReportPath;
const skippedRaw = await executeVerify({
  path: tmpRoot,
  target_type: "capability",
  target: "api.order.create",
  raw: true,
});
const skipped = JSON.parse(skippedRaw);
console.log("=== skipped report ===\n" + skippedRaw + "\n");
assert(skipped.report_fresh === true, "copied report should be fresh");
assert(skipped.report.summary.skipped === 1, "report should contain skipped scenario");
assert(skipped.bdd_coverage.ok === false, "skipped scenario should fail coverage");
assert(skipped.next_required_action === null, "skipped scenario should not require Step Evidence Review");

const flowDryRunRaw = await executeVerify({
  path: tmpRoot,
  target_type: "flow",
  target: "e2e.order.customerPurchase",
  dryRun: true,
  raw: true,
});
const flowDryRun = JSON.parse(flowDryRunRaw);
console.log("=== flow by id dry run ===\n" + flowDryRunRaw + "\n");
assert(flowDryRun.targets?.[0]?.name === "e2e.order.customerPurchase", "flow target should resolve by capability-map id");
assert(
  String(flowDryRun.targets?.[0]?.file).endsWith("harness/flows/e2e/order/customer-purchase.feature"),
  "flow target should use map file",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) console.log("\nAll verify BDD tests passed");
else process.exit(1);
