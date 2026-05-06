/**
 * BDD .feature execution helpers.
 */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Capability } from "./capability.ts";
import type { HarnessConfig } from "./config.ts";
import type { ParsedReport } from "./parsers/report.ts";
import { applyTemplate } from "./runner.ts";

export type BddConfig = NonNullable<HarnessConfig["bdd"]>;

export interface BddTarget {
  kind: "capability" | "flow";
  name: string;
  title: string;
  fileRel: string;
  fileAbs: string;
  scenarioNames: string[];
}

export interface BddCoverageResult {
  ok: boolean;
  targets: {
    name: string;
    title: string;
    file: string;
    ok: boolean;
    matched_by?: "file" | "title";
    missing_scenarios: string[];
  }[];
}

const TITLE_RE = /^\s*(?:Feature|功能|功能性|機能|Característica):\s*(.+)$/m;
const SCENARIO_RE =
  /^\s*(?:Scenario|Scenario Outline|场景|场景大纲|場景|場景大綱|Escenario):\s*(.+)$/gm;

export async function targetFromCapability(
  capability: Capability,
): Promise<BddTarget> {
  return {
    kind: "capability",
    name: capability.name,
    title: capability.title,
    fileRel: capability.fileRel,
    fileAbs: capability.fileAbs,
    scenarioNames: await readScenarioNames(capability.fileAbs),
  };
}

export async function readScenarioNames(fileAbs: string): Promise<string[]> {
  const content = await readFile(fileAbs, "utf-8");
  return [...content.matchAll(SCENARIO_RE)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

export async function readFeatureTitle(fileAbs: string): Promise<string> {
  const content = await readFile(fileAbs, "utf-8");
  return content.match(TITLE_RE)?.[1]?.trim() ?? "";
}

export function buildBddCommand(
  bdd: BddConfig,
  targets: BddTarget[],
  opts: { cwd?: string } = {},
): string {
  const featureArgs = targets
    .map((target) => {
      const feature = featurePathForCommand(target, opts.cwd);
      return applyTemplate(bdd.feature_arg_pattern, {
        feature,
        name: target.name,
        title: target.title,
      });
    })
    .filter(Boolean)
    .join(" ");

  const nameArg =
    targets.length === 1 && bdd.name_filter_pattern
      ? buildNameArg(bdd, targets[0]!, opts.cwd)
      : "";

  return [bdd.cmd, featureArgs, nameArg].filter(Boolean).join(" ");
}

function buildNameArg(
  bdd: BddConfig,
  target: BddTarget,
  cwd?: string,
): string {
  return applyTemplate(bdd.name_filter_pattern!, {
    feature: featurePathForCommand(target, cwd),
    name: target.name,
    title: target.title,
  });
}

function featurePathForCommand(target: BddTarget, cwd?: string): string {
  if (!cwd) return target.fileRel;
  return relative(cwd, target.fileAbs).replace(/\\/g, "/");
}

export function checkBddCoverage(
  parsed: ParsedReport | null,
  targets: BddTarget[],
): BddCoverageResult {
  if (!parsed) {
    return {
      ok: false,
      targets: targets.map((target) => ({
        name: target.name,
        title: target.title,
        file: target.fileRel,
        ok: false,
        missing_scenarios: target.scenarioNames,
      })),
    };
  }

  const targetResults = targets.map((target) => {
    const matched = findMatchingFeature(parsed, target);
    const reportedScenarios = new Set(
      (matched?.feature.scenarios ?? []).map((scenario) =>
        normalizeName(scenario.scenario),
      ),
    );
    const missingScenarios = target.scenarioNames.filter(
      (scenario) => !reportedScenarios.has(normalizeName(scenario)),
    );
    return {
      name: target.name,
      title: target.title,
      file: target.fileRel,
      ok: Boolean(matched) && missingScenarios.length === 0,
      matched_by: matched?.matchedBy,
      missing_scenarios: missingScenarios,
    };
  });

  return {
    ok: targetResults.every((target) => target.ok),
    targets: targetResults,
  };
}

function findMatchingFeature(
  parsed: ParsedReport,
  target: BddTarget,
): { feature: ParsedReport["features"][number]; matchedBy: "file" | "title" } | null {
  const targetFile = normalizePath(target.fileRel);
  for (const feature of parsed.features) {
    const featureFile = feature.featureFile ? normalizePath(feature.featureFile) : "";
    if (featureFile && (featureFile === targetFile || featureFile.endsWith(`/${targetFile}`))) {
      return { feature, matchedBy: "file" };
    }
  }

  const targetTitle = normalizeName(target.title);
  if (!targetTitle) return null;
  for (const feature of parsed.features) {
    if (normalizeName(feature.feature) === targetTitle) {
      return { feature, matchedBy: "title" };
    }
  }

  return null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
