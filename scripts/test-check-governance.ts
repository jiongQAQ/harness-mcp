#!/usr/bin/env bun
/**
 * check tool static harness governance tests.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeCheck } from "../src/tools/check.ts";

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-check-`);
await mkdir(resolve(tmpRoot, "harness/features/api/order"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
targets:
  - api
  - e2e
`,
);
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
      - id: api.order.missingCapability
        file: features/api/order/missing-capability.feature
        entrypoint: OrderController#missing
        intent: 验证缺少 capability 头会失败
flows:
  - id: e2e.order.customerPurchase
    file: flows/e2e/order/customer-purchase.feature
    uses:
      - api.order.create
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

  场景: 客户创建订单
    假设 客户已登录
    当 请求创建订单
    那么 应返回完整内容
`,
);
await writeFile(
  resolve(tmpRoot, "harness/features/api/order/missing-capability.feature"),
  `功能: 缺少能力头的 Feature

  场景: 没有稳定能力 id
    假设 AI 手工创建业务 feature
    当 文件没有 capability 元数据
    那么 应报告契约错误
`,
);
await mkdir(resolve(tmpRoot, "harness/legacy"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness/legacy/misplaced.feature"),
  `# language: zh-CN
# capability: legacy.misplaced
# entrypoint: LegacyController#misplaced
功能: 错误位置的业务能力

  业务来源:
    - 代码推断: LegacyController#misplaced

  意图:
    - 验证 check 会拒绝 features 目录外的业务能力。

  边界:
    - 只用于测试目录治理。

  待确认:
    - 无

  规则: 业务 feature 必须位于 features 目录
    场景: 错误位置被发现
      假设 存在一个业务 feature
      当 它不在 features 目录下
      那么 应报告业务契约目录错误
`,
);

const raw = await executeCheck({ path: tmpRoot, dryRun: true, raw: true });
const result = JSON.parse(raw);
console.log("=== check governance ===\n" + raw + "\n");
const normal = await executeCheck({ path: tmpRoot });
console.log("=== check normal output ===\n" + normal + "\n");

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

assert(result.status === "fail", "shallow feature should fail static governance");
assert(
  result.static_checks.some((c: any) => c.id === "feature_quality.rules" && c.level === "fail"),
  "missing Rule should be reported",
);
assert(
  result.static_checks.some((c: any) => c.id === "feature_quality.then_specificity" && c.level === "fail"),
  "generic Then should be reported",
);
assert(
  result.static_checks.some((c: any) => c.id === "feature_quality.language" && c.level === "fail"),
  "missing language header should be reported",
);
assert(
  result.static_checks.some((c: any) => c.id === "feature_quality.required_sections" && c.level === "fail"),
  "missing required sections should be reported",
);
assert(
  result.static_checks.some((c: any) => c.id === "feature_layout.business_features_under_features" && c.level === "fail"),
  "misplaced business feature should be reported",
);
assert(
  result.static_checks.some((c: any) => c.id === "capability_map.alignment" && c.level === "fail" && String(c.detail).includes("缺少 # capability")),
  "features without # capability should fail map alignment",
);
assert(
  result.static_checks.some((c: any) => c.id === "capability_map.alignment" && c.level === "fail" && String(c.detail).includes("flow file 不存在")),
  "missing flow files declared in map should fail map alignment",
);
assert(normal.includes("Static checks: FAIL"), "default check output should surface static failures");
assert(normal.includes("feature_quality.rules"), "default check output should list static failure details");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) console.log("\nAll check governance tests passed");
else process.exit(1);
