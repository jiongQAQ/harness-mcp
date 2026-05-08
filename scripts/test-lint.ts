#!/usr/bin/env bun
/**
 * lint tool tests — runs project-configured code-quality gates independently of check.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeLint } from "../src/tools/lint.ts";
import { runShell } from "../src/runner.ts";

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-lint-`);
await mkdir(resolve(tmpRoot, "src"), { recursive: true });
await writeFile(
  resolve(tmpRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
);
await writeFile(
  resolve(tmpRoot, "src/app.ts"),
  `export function add(a: number, b: number): number {
  return a + b;
}
`,
);

await runShell("git init", { cwd: tmpRoot });
await runShell("git add .", { cwd: tmpRoot });
await runShell('git -c user.email="test@example.com" -c user.name="Test" commit -m init', { cwd: tmpRoot });

await writeFile(
  resolve(tmpRoot, "src/app.ts"),
  `export function add(a: number, b: number): number {
  // @ts-ignore
  console.log("debug", a, b);
  debugger;
  return a + b;
}
`,
);

const raw = await executeLint({ path: tmpRoot, raw: true });
const result = JSON.parse(raw);
console.log("=== lint no defaults ===\n" + raw + "\n");

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

assert(result.command_type === "lint", "raw payload should be lint");
assert(result.status === "pass", "lint should not enforce default code-style rules");
assert(result.custom_summary.failed === 0, "custom rules should be empty unless configured");
assert(result.custom_violations.length === 0, "no custom violations should be reported without harness/lint/rules.yaml");

await rm(tmpRoot, { recursive: true, force: true });

const commandRoot = await mkdtemp(`${tmpdir()}/harness-mcp-lint-command-`);
await mkdir(resolve(commandRoot, "src"), { recursive: true });
await writeFile(
  resolve(commandRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
commands:
  lint:
    cmd: "sh -c 'echo lint failed >&2; exit 7'"
    workdir: "."
`,
);
await writeFile(resolve(commandRoot, "src/app.ts"), "export const ok = true;\n");

const commandRaw = await executeLint({ path: commandRoot, raw: true });
const commandResult = JSON.parse(commandRaw);
console.log("=== lint command ===\n" + commandRaw + "\n");

assert(commandResult.status === "fail", "commands.lint non-zero exit should fail lint");
assert(commandResult.exit_code === 7, "commands.lint exit code should be preserved");

await rm(commandRoot, { recursive: true, force: true });

const customRulesRoot = await mkdtemp(`${tmpdir()}/harness-mcp-lint-custom-rules-`);
await mkdir(resolve(customRulesRoot, "src"), { recursive: true });
await mkdir(resolve(customRulesRoot, "harness/lint"), { recursive: true });
await writeFile(
  resolve(customRulesRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
);
await writeFile(
  resolve(customRulesRoot, "harness/lint/rules.yaml"),
  `version: 1
rules:
  - id: no-try-catch
    pattern: "\\\\b(?:try|catch)\\\\b"
    message: "禁止 AI 写 try/catch"
    fix: "让异常继续抛出,或使用项目统一异常处理机制"
`,
);
await writeFile(
  resolve(customRulesRoot, "src/service.ts"),
  `export function run(): void {
  try {
    risky();
  } catch (error) {
    throw error;
  }
}

function risky(): void {}
`,
);

const customRulesRaw = await executeLint({ path: customRulesRoot, scope: "all", raw: true });
const customRulesResult = JSON.parse(customRulesRaw);
console.log("=== lint custom rules ===\n" + customRulesRaw + "\n");

assert(customRulesResult.status === "fail", "custom lint rules should fail when pattern matches");
assert(customRulesResult.custom_summary.checked_lines > 0, "custom rules should scan source lines");
assert(customRulesResult.custom_summary.failed >= 2, "try and catch should both be reported");
assert(
  customRulesResult.custom_violations.some((v: any) => v.rule === "custom:no-try-catch"),
  "custom no-try-catch rule should be reported with custom prefix",
);

await rm(customRulesRoot, { recursive: true, force: true });

const invalidRulesRoot = await mkdtemp(`${tmpdir()}/harness-mcp-lint-invalid-rules-`);
await mkdir(resolve(invalidRulesRoot, "harness/lint"), { recursive: true });
await writeFile(
  resolve(invalidRulesRoot, "harness.yaml"),
  `version: 1
spec_dir: harness
charter_dir: harness/_charter
`,
);
await writeFile(
  resolve(invalidRulesRoot, "harness/lint/rules.yaml"),
  `version: 1
rules:
  - id: bad-regex
    pattern: "["
    message: "bad"
    fix: "fix"
`,
);

const invalidRulesText = await executeLint({ path: invalidRulesRoot, scope: "all" });
console.log("=== lint invalid rules ===\n" + invalidRulesText + "\n");
assert(invalidRulesText.includes("harness/lint/rules.yaml"), "invalid lint rules should name rules file");
assert(invalidRulesText.includes("正确格式"), "invalid lint rules should include schema guidance");
assert(invalidRulesText.includes("Next action"), "invalid lint rules should include next action");

await rm(invalidRulesRoot, { recursive: true, force: true });

if (pass) console.log("\nAll lint tests passed");
else process.exit(1);
