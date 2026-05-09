#!/usr/bin/env bun
/**
 * Feature language configuration tests.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeContract } from "../src/tools/contract.ts";

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
        intent: Create order and reserve inventory
flows: []
`;

const englishFeature = `# language: en
# capability: order.create
# entrypoint: OrderController#create
@order @create

Feature: Create order

  Intent:
    - Customers create unpaid orders for purchasable items.

  Boundaries:
    - This capability only covers order creation, not payment or shipment.

  To Confirm:
    - Inventory reservation timeout is defined by another capability.

  Rule: In-stock items can create orders
    # sources:
    #   current: sources/2026-05-08-code-inference-order-create.md#in-stock-items
    #   timeline:
    #     - sources/2026-05-08-code-inference-order-create.md#in-stock-items

    Scenario: Customer buys an in-stock item
      Given the customer is signed in
      And SKU "sku-001" has 5 available units
      When the customer buys 2 units of SKU "sku-001"
      Then an unpaid order should be created
`;

const englishRoot = await mkdtemp(`${tmpdir()}/harness-mcp-language-en-`);
await mkdir(resolve(englishRoot, "harness/sources"), { recursive: true });
await writeFile(
  resolve(englishRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
language: en
`,
);
await writeFile(
  resolve(englishRoot, "harness/sources/2026-05-08-code-inference-order-create.md"),
  `# Order creation code inference

## in-stock-items

OrderController#create creates an unpaid order when inventory is available.
`,
);

const englishRaw = await executeContract({
  path: englishRoot,
  kind: "capability",
  id: "order.create",
  file: "features/order/create.feature",
  content: englishFeature,
  map_content: mapContent,
  raw: true,
});
console.log("=== english contract ===\n" + englishRaw + "\n");
const english = JSON.parse(englishRaw);
assert(english.ok === true, "language=en should accept English feature sections and # language: en");

const defaultChineseRoot = await mkdtemp(`${tmpdir()}/harness-mcp-language-default-`);
await mkdir(resolve(defaultChineseRoot, "harness/sources"), { recursive: true });
await writeFile(
  resolve(defaultChineseRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
);
await writeFile(
  resolve(defaultChineseRoot, "harness/sources/2026-05-08-code-inference-order-create.md"),
  `# Order creation code inference
`,
);

const defaultResult = await executeContract({
  path: defaultChineseRoot,
  kind: "capability",
  id: "order.create",
  file: "features/order/create.feature",
  content: englishFeature,
  map_content: mapContent,
});
console.log("=== default language rejects english ===\n" + defaultResult + "\n");
assert(defaultResult.includes("# language: zh-CN"), "default language should remain zh-CN");

await rm(englishRoot, { recursive: true, force: true });
await rm(defaultChineseRoot, { recursive: true, force: true });

if (pass) console.log("\nAll language tests passed");
else process.exit(1);
