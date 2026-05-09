#!/usr/bin/env bun
/**
 * contract tool tests: map + Rule-based feature write.
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeContract } from "../src/tools/contract.ts";

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-contract-`);
await mkdir(resolve(tmpRoot, "harness"), { recursive: true });
await mkdir(resolve(tmpRoot, "harness/sources"), { recursive: true });
await Bun.write(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
);
await Bun.write(
  resolve(tmpRoot, "harness/sources/2026-05-08-code-inference-order-create.md"),
  `# 创建订单规则代码推断

## 有库存商品可以创建订单

从 OrderService#create 推断有库存时创建订单。

## 创建订单时锁定库存

从 InventoryService#reserve 推断订单创建后锁定库存。
`,
);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const mapContent = `version: 1
domains:
  order:
    capabilities:
      - id: order.create
        file: features/order/create.feature
        entrypoint: OrderController#create
        intent: 创建订单并锁定库存
flows: []
`;

const validFeature = `# language: zh-CN
# capability: order.create
# entrypoint: OrderController#create
# files: OrderService#create, InventoryService#reserve
@order @create

功能: 创建订单

  意图:
    - 客户提交有效购买请求后,系统创建待支付订单并锁定库存。

  边界:
    - 本能力只定义订单创建,不定义支付、发货和售后。

  待确认:
    - 库存预占超时时间由其他能力定义。

  规则: 有库存商品可以创建订单
    # sources:
    #   current: sources/2026-05-08-code-inference-order-create.md#有库存商品可以创建订单
    #   timeline:
    #     - sources/2026-05-08-code-inference-order-create.md#有库存商品可以创建订单

    场景: 客户购买有库存商品
      假设 客户已登录
      而且 商品 "sku-001" 可售库存为 5
      当 客户购买 2 件商品 "sku-001"
      那么 应创建一笔待支付订单

    场景: 客户购买超过库存数量
      假设 客户已登录
      而且 商品 "sku-002" 可售库存为 1
      当 客户购买 2 件商品 "sku-002"
      那么 应拒绝创建订单

  规则: 创建订单时锁定库存
    # sources:
    #   current: sources/2026-05-08-code-inference-order-create.md#创建订单时锁定库存
    #   timeline:
    #     - sources/2026-05-08-code-inference-order-create.md#创建订单时锁定库存

    场景: 订单创建成功后库存被锁定
      假设 商品 "sku-003" 可售库存为 3
      当 客户购买 1 件商品 "sku-003"
      那么 应锁定 1 件商品 "sku-003" 的库存
      而且 可售库存应减少 1
`;

const noEntrypoint = validFeature.replace(/^# entrypoint: .+\n/m, "");
const noRule = validFeature.replace(/  规则:[\s\S]+$/m, `  场景: 客户购买有库存商品
    假设 客户已登录
    当 客户购买 2 件商品 "sku-001"
    那么 应创建一笔待支付订单
`);
const genericThen = validFeature.replace("应创建一笔待支付订单", "应返回完整内容");

for (const [content, expected] of [
  [noEntrypoint, "entrypoint"],
  [noRule, "Rule"],
  [genericThen, "空泛"],
] as const) {
  const result = await executeContract({
    path: tmpRoot,
    kind: "capability",
    id: "order.create",
    file: "features/order/create.feature",
    content,
    map_content: mapContent,
  });
  console.log(`=== invalid ${expected} ===\n${result}\n`);
  assert(result.includes(expected), `invalid feature should mention ${expected}`);
}

const createdRaw = await executeContract({
  path: tmpRoot,
  kind: "capability",
  id: "order.create",
  file: "features/order/create.feature",
  content: validFeature,
  map_content: mapContent,
  raw: true,
});
const created = JSON.parse(createdRaw);
console.log("=== valid contract ===\n" + createdRaw + "\n");
assert(created.ok === true, "contract should succeed");
assert(created.next_required_action === "Feature Contract Review", "contract should require Feature Contract Review");
assert(created.scenario_count === 3, "contract should count scenarios inside Rule");

const featureOnDisk = await readFile(resolve(tmpRoot, "harness/features/order/create.feature"), "utf-8");
const mapOnDisk = await readFile(resolve(tmpRoot, "harness/capability-map.yaml"), "utf-8");
assert(featureOnDisk.includes("创建订单时锁定库存"), "feature should be written");
assert(mapOnDisk.includes("entrypoint: OrderController#create"), "map should be written");

await rm(tmpRoot, { recursive: true, force: true });

if (pass) console.log("\nAll contract tests passed");
else process.exit(1);
