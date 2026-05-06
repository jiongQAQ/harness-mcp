export interface ParsedReport {
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
    total: number;
  };
  features: {
    feature: string;
    featureFile?: string;
    scenarios: {
      scenario: string;
      line?: number;
      status: "passed" | "failed" | "skipped" | "pending";
    }[];
  }[];
  failures: {
    feature: string;
    featureFile?: string;
    scenario: string;
    line?: number;
    failedStep?: string;
    errorMessage?: string;
  }[];
}
