/**
 * Surefire/JUnit XML 报告解析。
 *
 * Jest 的 jest-junit、Maven Surefire、Gradle JUnit XML 都会输出 testcase
 * 节点；这里按 testcase 汇总,把 failure 和 error 都归一为 failed。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ParsedReport } from "./types.ts";

interface XmlTestCase {
  attrs: Record<string, string>;
  body: string;
}

const TESTCASE_RE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/gi;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const FAILURE_RE = /<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/i;

export async function parseSurefireXml(
  reportPath: string,
): Promise<ParsedReport | null> {
  if (!existsSync(reportPath)) return null;

  let raw: string;
  try {
    raw = await readFile(reportPath, "utf-8");
  } catch {
    return null;
  }

  const cases = extractTestCases(raw);
  if (cases.length === 0) return null;

  const summary = { passed: 0, failed: 0, skipped: 0, pending: 0, total: 0 };
  const featuresByName = new Map<string, ParsedReport["features"][number]>();
  const failures: ParsedReport["failures"] = [];

  for (const testCase of cases) {
    summary.total++;
    const failed = extractFailure(testCase.body);
    const skipped = /<skipped\b/i.test(testCase.body);
    const featureName =
      testCase.attrs["classname"] || testCase.attrs["class"] || "JUnit XML";
    const scenarioName = testCase.attrs["name"] || "(unnamed testcase)";
    const featureEntry =
      featuresByName.get(featureName) ??
      {
        feature: featureName,
        scenarios: [],
      };
    featuresByName.set(featureName, featureEntry);

    if (failed) {
      summary.failed++;
      featureEntry.scenarios.push({
        scenario: scenarioName,
        status: "failed",
      });
      failures.push({
        feature: featureName,
        scenario: scenarioName,
        failedStep: failed.kind,
        errorMessage: failed.message,
      });
    } else if (skipped) {
      summary.skipped++;
      featureEntry.scenarios.push({
        scenario: scenarioName,
        status: "skipped",
      });
    } else {
      summary.passed++;
      featureEntry.scenarios.push({
        scenario: scenarioName,
        status: "passed",
      });
    }
  }

  return { summary, features: [...featuresByName.values()], failures };
}

function extractTestCases(raw: string): XmlTestCase[] {
  const cases: XmlTestCase[] = [];
  for (const match of raw.matchAll(TESTCASE_RE)) {
    cases.push({
      attrs: parseAttrs(match[1] ?? ""),
      body: match[3] ?? "",
    });
  }
  return cases;
}

function extractFailure(
  body: string,
): { kind: string; message: string | undefined } | null {
  const match = body.match(FAILURE_RE);
  if (!match) return null;

  const kind = match[1] ?? "failure";
  const attrs = parseAttrs(match[2] ?? "");
  const message = attrs["message"];
  const text = normalizeXmlText(match[4] ?? "");
  return {
    kind,
    message: joinUniqueLines([message, text]),
  };
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    const key = match[1];
    if (!key) continue;
    attrs[key] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function normalizeXmlText(raw: string): string {
  return decodeXml(
    raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function joinUniqueLines(values: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(normalized);
  }
  return lines.length ? lines.join("\n") : undefined;
}
