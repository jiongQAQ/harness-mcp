/**
 * Capability map — repository-level business capability boundary design.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const CapabilityEntrySchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  entrypoint: z.string().min(1),
  intent: z.string().min(1),
}).strict();

const DomainSchema = z.object({
  capabilities: z.array(CapabilityEntrySchema).default([]),
}).strict();

const FlowSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  uses: z.array(z.string().min(1)).default([]),
}).strict();

export const CapabilityMapSchema = z.object({
  version: z.literal(1),
  domains: z.record(z.string(), DomainSchema).default({}),
  flows: z.array(FlowSchema).default([]),
}).strict();

export type CapabilityMap = z.infer<typeof CapabilityMapSchema>;
export type CapabilityMapFlow = z.infer<typeof FlowSchema>;

export interface CapabilityMapCapability {
  target: string;
  domain: string;
  id: string;
  file: string;
  entrypoint: string;
  intent: string;
}

export const CAPABILITY_MAP_EXAMPLE = `version: 1
domains:
  order:
    capabilities:
      - id: api.order.create
        file: features/api/order/create.feature
        entrypoint: OrderController#create
        intent: 客户提交有效购买请求后创建待支付订单
      - id: web.order.create
        file: features/web/order/create.feature
        entrypoint: /orders/new
        intent: 前端承载创建订单表单和待支付状态展示
flows:
  - id: e2e.order.customerPurchase
    file: flows/e2e/order/customer-purchase.feature
    uses:
      - api.order.create
      - web.order.create
`;

export const CAPABILITY_MAP_SCHEMA_HELP = [
  "正确格式:",
  "```yaml",
  CAPABILITY_MAP_EXAMPLE.trimEnd(),
  "```",
  "",
  "正确顶层字段:",
  "  - version",
  "  - domains",
  "  - flows",
  "",
  "禁止格式:",
  "  - 顶层直接写 api.order.create:",
  "  - 顶层写 capabilities:",
  "",
  "说明:",
  "  - capability id 使用 <target>.<domain>.<action>",
  "  - capability file 必须位于 features/<target>/<domain>/",
  "  - flow id 使用 <target>.<domain>.<flowName>",
  "  - flow file 必须位于 flows/<target>/<domain>/",
  "  - target 必须在 harness.yaml targets 中声明",
  "",
  "Next action:",
  '  1. 调用 guide({ topic: "capability-map" }) 查看 schema',
  '  2. 使用 contract({ ..., map_content: "<完整正确 YAML>" }) 覆盖修复 capability-map.yaml',
].join("\n");

export type CapabilityMapLoad =
  | { exists: false; path: string }
  | { exists: true; path: string; ok: false; error: string }
  | {
      exists: true;
      path: string;
      ok: true;
      map: CapabilityMap;
      capabilities: CapabilityMapCapability[];
      flows: CapabilityMapFlow[];
    };

export function capabilityMapPath(specDirAbs: string): string {
  return resolve(specDirAbs, "capability-map.yaml");
}

export async function loadCapabilityMap(specDirAbs: string, targets: readonly string[]): Promise<CapabilityMapLoad> {
  const path = capabilityMapPath(specDirAbs);
  if (!existsSync(path)) return { exists: false, path };

  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch (e) {
    return { exists: true, path, ok: false, error: `无法读取 capability-map.yaml: ${(e as Error).message}` };
  }

  const parsed = parseCapabilityMapContent(content, targets);
  if (!parsed.ok) return { exists: true, path, ok: false, error: parsed.error };

  return {
    exists: true,
    path,
    ok: true,
    map: parsed.map,
    capabilities: flattenCapabilityMap(parsed.map),
    flows: parsed.map.flows,
  };
}

export function parseCapabilityMapContent(
  content: string,
  targets?: readonly string[],
): { ok: true; map: CapabilityMap } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (e) {
    return { ok: false, error: formatCapabilityMapError(`YAML 解析失败: ${(e as Error).message}`) };
  }

  const result = CapabilityMapSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: formatCapabilityMapError(formatZodIssues(result.error.issues)),
    };
  }

  const issues = validateCapabilityMap(result.data, targets);
  if (issues.length > 0) {
    return { ok: false, error: formatCapabilityMapError(issues.join("; ")) };
  }

  return { ok: true, map: result.data };
}

export function formatCapabilityMapError(error: string): string {
  return [
    "capability-map.yaml 格式错误:",
    `  - ${error}`,
    "",
    CAPABILITY_MAP_SCHEMA_HELP,
  ].join("\n");
}

export function flattenCapabilityMap(map: CapabilityMap): CapabilityMapCapability[] {
  const result: CapabilityMapCapability[] = [];
  for (const [domain, value] of Object.entries(map.domains)) {
    for (const capability of value.capabilities) {
      const idParts = parseTargetedId(capability.id);
      result.push({ target: idParts?.target ?? "", domain, ...capability });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeMapRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function validateMapRelFeaturePath(
  file: string,
): { ok: true; normalized: string; segments: string[] } | { ok: false; error: string } {
  if (file.includes("\\")) {
    return { ok: false, error: "不能包含反斜杠,请使用 / 分隔路径" };
  }

  const normalized = normalizeMapRelPath(file);
  if (!normalized.endsWith(".feature")) {
    return { ok: false, error: "必须是相对 .feature 路径" };
  }
  if (isAbsolute(normalized)) {
    return { ok: false, error: "必须是相对 .feature 路径" };
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "")) {
    return { ok: false, error: "不能包含空路径段" };
  }
  if (segments.some((segment) => segment === ".")) {
    return { ok: false, error: "不能包含 . 路径段" };
  }
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, error: "不能包含 .. 路径段" };
  }

  return { ok: true, normalized, segments };
}

function validateCapabilityMap(map: CapabilityMap, targets?: readonly string[]): string[] {
  const issues: string[] = [];
  const targetSet = targets ? new Set(targets) : null;
  const capabilityIds = new Set<string>();
  const capabilityFiles = new Map<string, string>();
  const flowIds = new Set<string>();

  for (const [domain, value] of Object.entries(map.domains)) {
    for (const capability of value.capabilities) {
      const idParts = parseTargetedId(capability.id);
      if (capabilityIds.has(capability.id)) {
        issues.push(`重复 capability id: ${capability.id}`);
      }
      capabilityIds.add(capability.id);

      if (!idParts) {
        issues.push(`capability id ${capability.id} 必须使用 <target>.<domain>.<action>`);
      } else {
        if (targetSet && !targetSet.has(idParts.target)) {
          issues.push(`capability id ${capability.id} 的 target "${idParts.target}" 未在 harness.yaml targets 中声明`);
        }
        if (idParts.domain !== domain) {
          issues.push(`capability id ${capability.id} 的 domain 必须是 "${domain}"`);
        }
      }
      const pathValidation = validateMapRelFeaturePath(capability.file);
      if (!pathValidation.ok) {
        issues.push(`capability ${capability.id} 的 file ${pathValidation.error}`);
      } else {
        const normalizedFile = pathValidation.normalized;
        const existingCapabilityId = capabilityFiles.get(normalizedFile);
        if (existingCapabilityId) {
          issues.push(`重复 capability file: ${capability.file} (${existingCapabilityId}, ${capability.id})`);
        } else {
          capabilityFiles.set(normalizedFile, capability.id);
        }

        const segments = pathValidation.segments;
        if (
          !idParts ||
          segments[0] !== "features" ||
          segments[1] !== idParts.target ||
          segments[2] !== domain ||
          segments.length < 4
        ) {
          issues.push(`capability ${capability.id} 的 file 必须位于 features/<target>/<domain>/`);
        } else if (targetSet && !targetSet.has(segments[1]!)) {
          issues.push(`capability ${capability.id} 的 file target "${segments[1]}" 未在 harness.yaml targets 中声明`);
        }
      }
    }
  }

  for (const flow of map.flows) {
    const idParts = parseTargetedId(flow.id);
    if (flowIds.has(flow.id)) {
      issues.push(`重复 flow id: ${flow.id}`);
    }
    flowIds.add(flow.id);

    if (!idParts) {
      issues.push(`flow id ${flow.id} 必须使用 <target>.<domain>.<flowName>`);
    } else {
      if (targetSet && !targetSet.has(idParts.target)) {
        issues.push(`flow id ${flow.id} 的 target "${idParts.target}" 未在 harness.yaml targets 中声明`);
      }
      if (!Object.prototype.hasOwnProperty.call(map.domains, idParts.domain)) {
        issues.push(`flow id ${flow.id} 使用未知 domain: ${idParts.domain}`);
      }
    }

    const pathValidation = validateMapRelFeaturePath(flow.file);
    if (!pathValidation.ok) {
      issues.push(`flow ${flow.id} 的 file ${pathValidation.error}`);
    } else if (
      !idParts ||
      pathValidation.segments[0] !== "flows" ||
      pathValidation.segments[1] !== idParts.target ||
      pathValidation.segments[2] !== idParts.domain ||
      pathValidation.segments.length < 4
    ) {
      issues.push(`flow ${flow.id} 的 file 必须位于 flows/<target>/<domain>/`);
    } else if (targetSet && !targetSet.has(pathValidation.segments[1]!)) {
      issues.push(`flow ${flow.id} 的 file target "${pathValidation.segments[1]}" 未在 harness.yaml targets 中声明`);
    }

    for (const used of flow.uses) {
      if (!capabilityIds.has(used)) {
        issues.push(`flow ${flow.id} 使用未知 capability: ${used}`);
      }
    }
  }

  return issues;
}

function parseTargetedId(id: string): { target: string; domain: string; rest: string[] } | null {
  const parts = id.split(".");
  if (parts.length < 3 || parts.some((part) => part.trim() === "")) return null;
  const [target, domain, ...rest] = parts;
  if (!target || !domain || rest.length === 0) return null;
  return { target, domain, rest };
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
