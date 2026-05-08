/**
 * discover - validate business discovery before writing BDD contracts.
 */
import { z } from "zod";

const EvidenceSchema = z.object({
  source: z.enum(["prd", "user", "code", "test", "human"]),
  detail: z.string().min(1),
}).strict();

export const DiscoverInputSchema = z.object({
  path: z.string().optional(),
  source: z.enum(["prd", "code", "mixed"]),
  goal: z.string().min(1),
  capability: z.string().min(1),
  entrypoints: z.array(z.string().min(1)).default([]),
  call_chain: z.array(z.string().min(1)).default([]),
  business_rules: z.array(z.string().min(1)).default([]),
  examples: z.array(z.string().min(1)).default([]),
  questions: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  raw: z.boolean().optional(),
});

export type DiscoverInput = z.infer<typeof DiscoverInputSchema>;

type CheckLevel = "pass" | "warn" | "fail";

interface DiscoveryCheck {
  id: string;
  level: CheckLevel;
  message: string;
  detail?: string;
}

const GENERIC_BUSINESS_RE =
  /(?:接口|api|请求|调用).{0,12}(?:成功|完整内容|完整的.*内容|200|ok)|(?:应|应该)?返回完整内容|状态码.{0,4}200/i;
const BUSINESS_DEPTH_RE =
  /权限|角色|状态|发布|下架|删除|软删除|过滤|排序|顺序|隐藏|答案|解析|副作用|记录|进度|事件|日志|拒绝|不存在|无权限|异常|失败|边界|默认|兜底|范围|学段|班级/;
const NEGATIVE_EXAMPLE_RE = /拒绝|不存在|无权限|未发布|下架|删除|软删除|失败|异常|边界|空|隐藏|不得|不能/;

export async function executeDiscover(input: DiscoverInput): Promise<string> {
  const checks = analyzeDiscovery(input);
  const ok = !checks.some((check) => check.level === "fail");
  const payload = {
    ok,
    capability: input.capability,
    goal: input.goal,
    input: {
      source: input.source,
      goal: input.goal,
      capability: input.capability,
      entrypoints: input.entrypoints,
      call_chain: input.call_chain,
      business_rules: input.business_rules,
      examples: input.examples,
      questions: input.questions,
      evidence: input.evidence,
    },
    checks,
    next_required_action: ok ? "Human Confirmation" : null,
  };

  if (input.raw) return JSON.stringify(payload, null, 2);
  return renderDiscovery(payload);
}

function analyzeDiscovery(input: DiscoverInput): DiscoveryCheck[] {
  const checks: DiscoveryCheck[] = [];

  checks.push({
    id: "discovery.entrypoints",
    level: input.entrypoints.length > 0 ? "pass" : "fail",
    message:
      input.entrypoints.length > 0
        ? "业务入口已声明"
        : "缺少业务入口: API / Controller / Application Service / Consumer / Job",
    detail: input.entrypoints.join(", ") || undefined,
  });

  const needsCallChain = input.source === "code" || input.source === "mixed";
  checks.push({
    id: "discovery.call_chain",
    level: !needsCallChain || input.call_chain.length > 0 ? "pass" : "fail",
    message:
      !needsCallChain || input.call_chain.length > 0
        ? "调用链已覆盖"
        : "代码/混合来源必须列出入口到结束的核心 service 调用链",
    detail: input.call_chain.join(", ") || undefined,
  });

  const meaningfulRules = input.business_rules.filter(
    (rule) => !GENERIC_BUSINESS_RE.test(rule) && BUSINESS_DEPTH_RE.test(rule),
  );
  checks.push({
    id: "discovery.rules.business_depth",
    level: meaningfulRules.length > 0 ? "pass" : "fail",
    message:
      meaningfulRules.length > 0
        ? "业务规则包含可验证业务逻辑"
        : "业务规则过浅:不能只写 API/接口成功,必须包含权限、状态、过滤、字段隐藏、副作用或异常分支等业务规则",
    detail: input.business_rules.join("; ") || undefined,
  });

  const meaningfulExamples = input.examples.filter((example) => !GENERIC_BUSINESS_RE.test(example));
  checks.push({
    id: "discovery.examples",
    level: input.examples.length >= 2 && meaningfulExamples.length >= 2 ? "pass" : "fail",
    message:
      input.examples.length >= 2 && meaningfulExamples.length >= 2
        ? "业务例子足够支撑契约"
        : "至少需要两个具体业务例子,不能只写请求成功",
    detail: input.examples.join("; ") || undefined,
  });

  const hasNegativeExample = input.examples.some((example) => NEGATIVE_EXAMPLE_RE.test(example));
  checks.push({
    id: "discovery.examples.negative_branch",
    level: hasNegativeExample ? "pass" : "warn",
    message: hasNegativeExample ? "已包含失败/边界例子" : "建议补充失败、边界或拒绝分支例子",
  });

  checks.push({
    id: "discovery.evidence",
    level: input.evidence.length > 0 ? "pass" : "fail",
    message: input.evidence.length > 0 ? "证据来源已声明" : "缺少证据来源: PRD / 用户提供 / 代码推断 / 现有测试 / 人工确认",
    detail: input.evidence.map((e) => `${e.source}: ${e.detail}`).join("; ") || undefined,
  });

  checks.push({
    id: "discovery.questions",
    level: input.questions.length > 0 ? "pass" : "warn",
    message: input.questions.length > 0 ? "待确认问题已显式列出" : "没有待确认问题;若来自代码推断,请确认是否存在未确认业务规则",
    detail: input.questions.join("; ") || undefined,
  });

  return checks;
}

function renderDiscovery(payload: {
  ok: boolean;
  capability: string;
  goal: string;
  input: Omit<DiscoverInput, "path" | "raw">;
  checks: DiscoveryCheck[];
  next_required_action: string | null;
}): string {
  const lines: string[] = [];
  lines.push("Feature Discovery Review");
  lines.push(`capability: ${payload.capability}`);
  lines.push(`goal: ${payload.goal}`);
  lines.push(`status: ${payload.ok ? "PASS" : "FAIL"}`);
  lines.push("");
  for (const check of payload.checks) {
    lines.push(`${check.level.toUpperCase()} ${check.id}: ${check.message}`);
    if (check.detail) lines.push(`  ${check.detail}`);
  }
  if (payload.next_required_action) {
    lines.push("");
    lines.push(`Next required action: ${payload.next_required_action}`);
  }
  return lines.join("\n");
}
