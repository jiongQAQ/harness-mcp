import { parseCucumberJson } from "./cucumber-json.ts";
import { parseSurefireXml } from "./surefire-xml.ts";
import type { ParsedReport } from "./types.ts";

export type { ParsedReport } from "./types.ts";

export type ReportFormat = "cucumber-json" | "surefire-xml" | "pytest-json";

export const SUPPORTED_REPORT_FORMATS = new Set<ReportFormat>([
  "cucumber-json",
  "surefire-xml",
]);

export async function parseReport(
  format: ReportFormat,
  reportPath: string,
): Promise<ParsedReport | null> {
  if (format === "cucumber-json") return parseCucumberJson(reportPath);
  if (format === "surefire-xml") return parseSurefireXml(reportPath);
  return null;
}
