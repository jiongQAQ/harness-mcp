#!/usr/bin/env bun
/**
 * Project root resolution tests.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveProjectRoot } from "../src/project.ts";

let pass = true;
const assert = (ok: boolean, message: string) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    pass = false;
  }
};

const originalCwd = process.cwd();
const originalEnv = process.env["HARNESS_PROJECT_ROOT"];

const tmpRoot = await mkdtemp(`${tmpdir()}/harness-mcp-project-root-`);

try {
  const harnessProject = resolve(tmpRoot, "with-harness");
  const nestedHarness = resolve(harnessProject, "apps/api/src");
  await mkdir(nestedHarness, { recursive: true });
  await writeFile(resolve(harnessProject, "harness.yaml"), "version: 1\n");
  process.chdir(nestedHarness);
  delete process.env["HARNESS_PROJECT_ROOT"];
  assert(resolveProjectRoot() === await realpath(harnessProject), "should find nearest harness.yaml from cwd");

  const gitProject = resolve(tmpRoot, "with-git");
  const nestedGit = resolve(gitProject, "packages/web/src");
  await mkdir(resolve(gitProject, ".git"), { recursive: true });
  await mkdir(nestedGit, { recursive: true });
  process.chdir(nestedGit);
  assert(resolveProjectRoot() === await realpath(gitProject), "should fall back to nearest git root");

  const envProject = resolve(tmpRoot, "from-env");
  const plainDir = resolve(tmpRoot, "plain/nested");
  await mkdir(envProject, { recursive: true });
  await mkdir(plainDir, { recursive: true });
  process.chdir(plainDir);
  process.env["HARNESS_PROJECT_ROOT"] = envProject;
  assert(resolveProjectRoot() === envProject, "should use env root when no harness.yaml or git root exists");

  const explicitProject = resolve(tmpRoot, "explicit");
  await mkdir(explicitProject, { recursive: true });
  assert(resolveProjectRoot(explicitProject) === explicitProject, "explicit path should have highest priority");
} finally {
  process.chdir(originalCwd);
  if (originalEnv === undefined) delete process.env["HARNESS_PROJECT_ROOT"];
  else process.env["HARNESS_PROJECT_ROOT"] = originalEnv;
  await rm(tmpRoot, { recursive: true, force: true });
}

if (pass) console.log("All project root tests passed");
else process.exit(1);
