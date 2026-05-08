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
  domain: string;
  id: string;
  file: string;
  entrypoint: string;
  intent: string;
}

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

export async function loadCapabilityMap(specDirAbs: string): Promise<CapabilityMapLoad> {
  const path = capabilityMapPath(specDirAbs);
  if (!existsSync(path)) return { exists: false, path };

  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch (e) {
    return { exists: true, path, ok: false, error: `无法读取 capability-map.yaml: ${(e as Error).message}` };
  }

  const parsed = parseCapabilityMapContent(content);
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
): { ok: true; map: CapabilityMap } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (e) {
    return { ok: false, error: `YAML 解析失败: ${(e as Error).message}` };
  }

  const result = CapabilityMapSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }

  const issues = validateCapabilityMap(result.data);
  if (issues.length > 0) {
    return { ok: false, error: issues.join("; ") };
  }

  return { ok: true, map: result.data };
}

export function flattenCapabilityMap(map: CapabilityMap): CapabilityMapCapability[] {
  const result: CapabilityMapCapability[] = [];
  for (const [domain, value] of Object.entries(map.domains)) {
    for (const capability of value.capabilities) {
      result.push({ domain, ...capability });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function findCapabilityMapEntry(
  load: CapabilityMapLoad,
  capability: string,
): CapabilityMapCapability | null {
  if (!load.exists || !load.ok) return null;
  return load.capabilities.find((entry) => entry.id === capability) ?? null;
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

function validateCapabilityMap(map: CapabilityMap): string[] {
  const issues: string[] = [];
  const capabilityIds = new Set<string>();
  const capabilityFiles = new Map<string, string>();
  const flowIds = new Set<string>();

  for (const [domain, value] of Object.entries(map.domains)) {
    for (const capability of value.capabilities) {
      if (capabilityIds.has(capability.id)) {
        issues.push(`重复 capability id: ${capability.id}`);
      }
      capabilityIds.add(capability.id);

      if (!capability.id.startsWith(`${domain}.`)) {
        issues.push(`capability id ${capability.id} 必须以 domain "${domain}." 开头`);
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
        if (segments[0] !== "features" || segments[1] !== domain || segments.length < 3) {
          issues.push(`capability ${capability.id} 的 file 必须位于 features/${domain}/`);
        }
      }
    }
  }

  for (const flow of map.flows) {
    if (flowIds.has(flow.id)) {
      issues.push(`重复 flow id: ${flow.id}`);
    }
    flowIds.add(flow.id);

    const pathValidation = validateMapRelFeaturePath(flow.file);
    if (!pathValidation.ok) {
      issues.push(`flow ${flow.id} 的 file ${pathValidation.error}`);
    } else if (pathValidation.segments[0] !== "flows") {
      issues.push(`flow ${flow.id} 的 file 必须位于 flows/`);
    }

    for (const used of flow.uses) {
      if (!capabilityIds.has(used)) {
        issues.push(`flow ${flow.id} 使用未知 capability: ${used}`);
      }
    }
  }

  return issues;
}
