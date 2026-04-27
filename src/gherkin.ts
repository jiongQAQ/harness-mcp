/**
 * Gherkin 语法校验 — 用 @cucumber/gherkin 解析,捕获错误。
 */
import {
  AstBuilder,
  Parser,
  GherkinClassicTokenMatcher,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

export interface GherkinValidationResult {
  ok: boolean;
  /** 解析错误(如果有) */
  errors: { line: number; column?: number; message: string }[];
  /** 顶层 Feature 标题(成功时) */
  featureName?: string;
  /** 场景数 */
  scenarioCount?: number;
}

export function validateGherkin(content: string): GherkinValidationResult {
  const idGen = IdGenerator.uuid();
  const builder = new AstBuilder(idGen);
  const matcher = new GherkinClassicTokenMatcher();
  const parser = new Parser(builder, matcher);

  try {
    const doc = parser.parse(content);
    const feature = doc.feature;
    let scenarioCount = 0;
    if (feature) {
      for (const child of feature.children) {
        if (child.scenario) scenarioCount++;
      }
    }
    return {
      ok: true,
      errors: [],
      featureName: feature?.name,
      scenarioCount,
    };
  } catch (e: any) {
    // CompositeParserException carries an `errors` array
    const errors: GherkinValidationResult["errors"] = [];
    const inner: unknown[] = Array.isArray(e?.errors) ? e.errors : [e];
    for (const err of inner) {
      const ex = err as any;
      errors.push({
        line: ex?.location?.line ?? 0,
        column: ex?.location?.column,
        message: ex?.message ?? String(ex),
      });
    }
    return { ok: false, errors };
  }
}
