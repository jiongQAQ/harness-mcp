#!/usr/bin/env bun
/**
 * Business discovery contract tests.
 */
import { executeDiscover } from "../src/tools/discover.ts";

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const shallowRaw = await executeDiscover({
  source: "code",
  goal: "客户创建订单",
  capability: "order.create",
  entrypoints: ["OrderController#create"],
  call_chain: ["OrderService#create"],
  business_rules: ["接口请求成功后应返回完整内容"],
  examples: ["请求详情接口成功返回完整内容"],
  questions: [],
  evidence: [{ source: "code", detail: "OrderService#create" }],
  raw: true,
});
const shallow = JSON.parse(shallowRaw);
console.log("=== shallow discovery ===\n" + shallowRaw + "\n");
assert(shallow.ok === false, "shallow API-success discovery should fail");
assert(
  shallow.checks.some((c: any) => c.id === "discovery.rules.business_depth" && c.level === "fail"),
  "shallow discovery should fail business depth",
);

const richRaw = await executeDiscover({
  source: "mixed",
  goal: "客户创建订单",
  capability: "order.create",
  entrypoints: ["OrderController#create"],
  call_chain: [
    "OrderService#create",
    "InventoryService#reserve",
    "PricingService#calculate",
  ],
  business_rules: [
    "客户只能使用自己的有效收货地址创建订单。",
    "有库存时创建待支付订单并锁定库存。",
    "库存不足时拒绝创建订单且库存不变化。",
    "订单金额必须按当前价格和优惠规则计算。",
  ],
  examples: [
    "库存充足时创建待支付订单。",
    "库存不足时拒绝创建订单。",
    "无效收货地址不能创建订单。",
    "优惠券过期时按无优惠计算。",
  ],
  questions: ["库存预占超时时间是多少？"],
  evidence: [
    { source: "code", detail: "OrderService#create" },
    { source: "code", detail: "InventoryService#reserve" },
    { source: "human", detail: "库存预占超时时间待人工确认" },
  ],
  raw: true,
});
const rich = JSON.parse(richRaw);
console.log("=== rich discovery ===\n" + richRaw + "\n");
assert(rich.ok === true, "rich discovery should pass");
assert(rich.next_required_action === "Human Confirmation", "rich discovery should require human confirmation");
assert(String(await executeDiscover({ ...rich.input, raw: false })).includes("Feature Discovery Review"), "text output should include review heading");

if (pass) console.log("\nAll discovery tests passed");
else process.exit(1);
