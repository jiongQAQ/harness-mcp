/**
 * Cucumber JSON 报告解析(cucumber-jvm 和 cucumber-js 都支持)
 *
 * 报告格式参考: https://cucumber.io/docs/cucumber/reporting/?lang=java#json
 *   [
 *     {
 *       "uri": "...",
 *       "name": "Feature 标题",
 *       "elements": [
 *         {
 *           "type": "scenario",
 *           "name": "场景名",
 *           "line": 17,
 *           "steps": [
 *             { "name": "...", "result": { "status": "passed|failed|skipped|pending|undefined", "error_message": "..." } }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface ParsedReport {
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
    total: number;
  };
  failures: {
    feature: string;
    featureFile?: string;
    scenario: string;
    line?: number;
    failedStep?: string;
    errorMessage?: string;
  }[];
}

export async function parseCucumberJson(
  reportPath: string,
): Promise<ParsedReport | null> {
  if (!existsSync(reportPath)) return null;

  let raw: string;
  try {
    raw = await readFile(reportPath, "utf-8");
  } catch {
    return null;
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const summary = { passed: 0, failed: 0, skipped: 0, pending: 0, total: 0 };
  const failures: ParsedReport["failures"] = [];

  for (const feat of data) {
    const featureName = feat?.name ?? "";
    const featureFile = feat?.uri;
    for (const el of feat?.elements ?? []) {
      if (el?.type !== "scenario") continue;
      const scenarioName = el?.name ?? "";
      const line = el?.line;

      // 一个场景的状态 = 所有 step 状态的"最坏"那个
      let scenarioStatus = "passed";
      let failedStep: string | undefined;
      let errorMessage: string | undefined;
      for (const step of el?.steps ?? []) {
        const status = step?.result?.status ?? "passed";
        if (status === "failed") {
          scenarioStatus = "failed";
          failedStep = step?.name;
          errorMessage = step?.result?.error_message;
          break;
        } else if (status === "skipped" && scenarioStatus !== "failed") {
          scenarioStatus = "skipped";
        } else if (status === "pending" && scenarioStatus === "passed") {
          scenarioStatus = "pending";
        } else if (status === "undefined" && scenarioStatus === "passed") {
          scenarioStatus = "failed";
          failedStep = step?.name;
          errorMessage = "Undefined step";
        }
      }

      summary.total++;
      if (scenarioStatus === "failed") {
        summary.failed++;
        failures.push({
          feature: featureName,
          featureFile,
          scenario: scenarioName,
          line,
          failedStep,
          errorMessage,
        });
      } else if (scenarioStatus === "skipped") {
        summary.skipped++;
      } else if (scenarioStatus === "pending") {
        summary.pending++;
      } else {
        summary.passed++;
      }
    }
  }

  return { summary, failures };
}
