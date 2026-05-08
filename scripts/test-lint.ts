#!/usr/bin/env bun
/**
 * lint tool tests — catches AI code-quality violations independently of check.
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
console.log("=== lint built-in ===\n" + raw + "\n");

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

assert(result.command_type === "lint", "raw payload should be lint");
assert(result.status === "fail", "built-in lint should fail on bad added lines");
assert(result.builtin_summary.failed >= 3, "console.log, debugger and ts-ignore should fail");
assert(
  result.violations.some((v: any) => v.rule === "no-console-log"),
  "console.log violation should be reported",
);
assert(
  result.violations.some((v: any) => v.rule === "no-debugger"),
  "debugger violation should be reported",
);
assert(
  result.violations.some((v: any) => v.rule === "no-ts-ignore"),
  "@ts-ignore violation should be reported",
);

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

if (pass) console.log("\nAll lint tests passed");
else process.exit(1);
