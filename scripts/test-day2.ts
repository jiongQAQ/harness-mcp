#!/usr/bin/env bun
/**
 * Day 2 单元测试 — 直接调 config / capability,不走 MCP。
 */
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { discoverCapabilities, matchCapabilities } from "../src/capability.ts";

const fixtureRoot = resolve(import.meta.dir, "../examples/sel-service-yaml");

console.log("=== Test 1: loadConfig ===");
const loaded = await loadConfig(fixtureRoot);
if (!loaded) {
  console.error("❌ FAIL: loadConfig returned null");
  process.exit(1);
}
console.log("projectRoot:", loaded.projectRoot);
console.log("specDirAbs:", loaded.specDirAbs);
console.log("charterDirAbs:", loaded.charterDirAbs);
console.log("bdd.runner:", loaded.config.bdd?.runner);
console.log("bdd.cmd:", loaded.config.bdd?.cmd);
console.log("ai_hints lines:", loaded.config.ai_hints?.split("\n").length);

console.log("\n=== Test 2: discoverCapabilities ===");
const caps = await discoverCapabilities(
  loaded.projectRoot,
  loaded.specDirAbs,
  loaded.charterDirAbs,
);
console.log(`发现 ${caps.length} 个能力:`);
for (const c of caps) {
  console.log(
    `  - ${c.name} [${c.tags.join(",")}] -> ${c.fileRel} (title: ${c.title})`,
  );
}

if (caps.length !== 2) {
  console.error(`❌ FAIL: expect 2 caps, got ${caps.length}`);
  process.exit(1);
}

const getByUid = caps.find((c) => c.name === "subject-literacy.getByUid");
if (!getByUid) {
  console.error("❌ FAIL: subject-literacy.getByUid not found");
  process.exit(1);
}
if (!getByUid.tags.includes("@subject-literacy")) {
  console.error("❌ FAIL: tags missing @subject-literacy");
  process.exit(1);
}

console.log("\n=== Test 3: matchCapabilities (fuzzy) ===");
const m1 = matchCapabilities(caps, "GETBYUID");
console.log(`query='GETBYUID' -> ${m1.length} hits: ${m1.map((c) => c.name).join(", ")}`);
if (m1.length !== 1 || m1[0]!.name !== "subject-literacy.getByUid") {
  console.error("❌ FAIL: fuzzy match GETBYUID failed");
  process.exit(1);
}

const m2 = matchCapabilities(caps, "subject-literacy");
console.log(`query='subject-literacy' -> ${m2.length} hits`);
if (m2.length !== 2) {
  console.error(`❌ FAIL: expect 2 hits for 'subject-literacy', got ${m2.length}`);
  process.exit(1);
}

const m3 = matchCapabilities(caps, "no-such");
if (m3.length !== 0) {
  console.error("❌ FAIL: empty match expected");
  process.exit(1);
}

console.log("\n=== Test 4: missing harness.yaml returns null ===");
const missing = await loadConfig("/tmp/no-such-dir-12345");
if (missing !== null) {
  console.error("❌ FAIL: should be null");
  process.exit(1);
}
console.log("OK");

console.log("\n✅ All Day 2 tests passed");
