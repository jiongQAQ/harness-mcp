#!/usr/bin/env bun
/**
 * context/check charter markdown tests.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeCheck } from "../src/tools/check.ts";
import { executeContext } from "../src/tools/context.ts";

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-charter-`);
await mkdir(resolve(tmpRoot, "harness/_charter"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
);
await writeFile(
  resolve(tmpRoot, "harness/_charter/architecture.md"),
  `# Architecture

- Java 8
- Spring Boot 2.7.8
`,
);
await writeFile(
  resolve(tmpRoot, "harness/_charter/legacy.feature"),
  `# language: zh-CN
功能: 旧章程格式

  场景: 不再使用 feature 写章程
    那么 应迁移到 Markdown
`,
);

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const contextRaw = await executeContext({ path: tmpRoot, raw: true });
const context = JSON.parse(contextRaw);
console.log("=== context charter ===\n" + contextRaw + "\n");

assert(
  context.charter.some((item: any) => item.file.endsWith("harness/_charter/architecture.md")),
  "context should read _charter Markdown files",
);
assert(
  context.charter.every((item: any) => !item.file.endsWith(".feature")),
  "context should not load _charter .feature files",
);

const checkRaw = await executeCheck({ path: tmpRoot, dryRun: true, raw: true });
const check = JSON.parse(checkRaw);
console.log("=== check charter ===\n" + checkRaw + "\n");
assert(
  check.static_checks.some((item: any) =>
    item.id === "charter_format.markdown" &&
    item.level === "fail" &&
    String(item.detail).includes("legacy.feature")
  ),
  "check should fail _charter .feature files and require Markdown",
);

await rm(tmpRoot, { recursive: true, force: true });

if (pass) console.log("\nAll context charter tests passed");
else process.exit(1);
