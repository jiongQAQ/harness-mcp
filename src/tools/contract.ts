/**
 * contract - write capability-map and Rule-based BDD contract files.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  capabilityMapPath,
  flattenCapabilityMap,
  formatCapabilityMapError,
  loadCapabilityMap,
  normalizeMapRelPath,
  parseCapabilityMapContent,
} from "../capability_map.ts";
import { formatMissingHarnessConfig, loadConfig } from "../config.ts";
import {
  checkFeatureQuality,
  formatFeatureQualityFailure,
} from "../feature_quality.ts";
import { validateGherkin } from "../gherkin.ts";
import { resolveProjectRoot } from "../project.ts";
import {
  FEATURE_CONTRACT_REVIEW_ACTION,
  renderNextRequiredAction,
} from "../review_protocol.ts";

export const ContractInputSchema = z.object({
  path: z.string().optional().describe("项目根目录;不传则从当前目录向上查找 harness.yaml 或 .git"),
  kind: z.enum(["capability", "flow"]).default("capability"),
  id: z.string().min(1).describe("capability id 或 flow id"),
  file: z.string().min(1).describe("相对 spec_dir 的 .feature 文件路径"),
  content: z.string().min(1).describe("完整 .feature 内容"),
  map_content: z.string().optional().describe("可选:完整 capability-map.yaml 内容;会与 feature 一起校验后写入"),
  raw: z.boolean().optional(),
});

export type ContractInput = z.infer<typeof ContractInputSchema>;

const CAP_RE = /^#\s*capability:\s*(.+)\s*$/m;
const ENTRYPOINT_RE = /^#\s*entrypoint:\s*(.+)\s*$/m;

export async function executeContract(input: ContractInput): Promise<string> {
  const root = resolveProjectRoot(input.path);
  const loaded = await loadConfig(root);
  if (!loaded) return formatMissingHarnessConfig(root);

  const target = resolveTargetFile(
    loaded.projectRoot,
    loaded.specDirAbs,
    input.file,
    input.kind,
    loaded.config.targets,
    loaded.config.workspace?.target,
  );
  if (!target.ok) return target.message;

  const mapValidation = await validateMapForContract(
    input,
    loaded.specDirAbs,
    loaded.config.targets,
    loaded.config.workspace?.target,
  );
  if (!mapValidation.ok) return mapValidation.message;

  const featureValidation = await validateFeatureForContract(
    input,
    target.fileRel,
    loaded.config.language,
  );
  if (!featureValidation.ok) return featureValidation.message;

  if (existsSync(target.abs)) {
    const current = await readFile(target.abs, "utf-8");
    const currentCapability = current.match(CAP_RE)?.[1]?.trim();
    if (currentCapability && currentCapability !== input.id && input.kind === "capability") {
      return `目标文件已有其他 capability: ${currentCapability}`;
    }
  }

  if (input.map_content) {
    const mapPath = capabilityMapPath(loaded.specDirAbs);
    await mkdir(dirname(mapPath), { recursive: true });
    await writeFile(mapPath, input.map_content, "utf-8");
  }

  await mkdir(dirname(target.abs), { recursive: true });
  await writeFile(target.abs, input.content, "utf-8");

  const payload = {
    ok: true,
    kind: input.kind,
    id: input.id,
    file: target.fileRel,
    feature: featureValidation.featureName,
    scenario_count: featureValidation.scenarioCount,
    next_required_action: FEATURE_CONTRACT_REVIEW_ACTION,
  };

  if (input.raw) return JSON.stringify(payload, null, 2);
  return [
    `已写入 ${payload.file}`,
    `${payload.kind}: ${payload.id}`,
    `Feature: ${payload.feature || "?"}`,
    `scenarios: ${payload.scenario_count}`,
    renderNextRequiredAction(FEATURE_CONTRACT_REVIEW_ACTION),
  ].join("\n");
}

async function validateMapForContract(
  input: ContractInput,
  specDirAbs: string,
  targets: readonly string[],
  workspaceTarget?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const idParts = parseTargetedId(input.id);
  if (!idParts) return { ok: false, message: `${input.kind} id 必须使用 <target>.<domain>.<name>: ${input.id}` };
  if (!targets.includes(idParts.target)) {
    return { ok: false, message: `${input.kind} id 的 target "${idParts.target}" 未在 harness.yaml targets 中声明` };
  }
  if (workspaceTarget && idParts.target !== workspaceTarget) {
    return { ok: false, message: `workspace.target=${workspaceTarget} 不能写 target ${idParts.target}` };
  }

  const parsed = await loadOrParseContractMap(input.map_content, specDirAbs, targets);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  if (input.kind === "capability") {
    const entry = parsed.capabilities.find((capability) => capability.id === input.id);
    if (!entry) return { ok: false, message: `能力 ${input.id} 未在 capability-map.yaml 中声明` };
    if (normalizeMapRelPath(entry.file) !== normalizeMapRelPath(input.file)) {
      return { ok: false, message: `capability-map.yaml 中 ${input.id} 的 file 是 ${entry.file}` };
    }
  } else {
    const flow = parsed.flows.find((item) => item.id === input.id);
    if (!flow) return { ok: false, message: `flow ${input.id} 未在 capability-map.yaml 中声明` };
    if (normalizeMapRelPath(flow.file) !== normalizeMapRelPath(input.file)) {
      return { ok: false, message: `capability-map.yaml 中 ${input.id} 的 file 是 ${flow.file}` };
    }
  }

  return { ok: true };
}

async function loadOrParseContractMap(
  mapContent: string | undefined,
  specDirAbs: string,
  targets: readonly string[],
): Promise<
  | {
      ok: true;
      capabilities: ReturnType<typeof flattenCapabilityMap>;
      flows: { id: string; file: string; uses: string[] }[];
    }
  | { ok: false; message: string }
> {
  if (mapContent) {
    const parsed = parseCapabilityMapContent(mapContent, targets);
    if (!parsed.ok) {
      return { ok: false, message: parsed.error };
    }
    return {
      ok: true,
      capabilities: flattenCapabilityMap(parsed.map),
      flows: parsed.map.flows,
    };
  }

  const loaded = await loadCapabilityMap(specDirAbs, targets);
  if (!loaded.exists) {
    return {
      ok: false,
      message: formatCapabilityMapError("缺少 capability-map.yaml。请通过 contract.map_content 提交业务能力地图。"),
    };
  }
  if (!loaded.ok) {
    return { ok: false, message: loaded.error };
  }
  return { ok: true, capabilities: loaded.capabilities, flows: loaded.flows };
}

async function validateFeatureForContract(
  input: ContractInput,
  fileRel: string,
  language: "zh-CN" | "en",
): Promise<
  | { ok: true; featureName: string; scenarioCount: number }
  | { ok: false; message: string }
> {
  if (input.kind === "capability") {
    const contentCapability = input.content.match(CAP_RE)?.[1]?.trim();
    if (!contentCapability) return { ok: false, message: `content 必须包含 # capability: ${input.id}` };
    if (contentCapability !== input.id) {
      return { ok: false, message: `# capability 不匹配: content 是 "${contentCapability}", 参数是 "${input.id}"` };
    }
    if (!input.content.match(ENTRYPOINT_RE)?.[1]?.trim()) {
      return { ok: false, message: "content 必须包含 # entrypoint: <业务入口>" };
    }
  }

  const quality = checkFeatureQuality(input.content, fileRel, language);
  if (!quality.ok) return { ok: false, message: formatFeatureQualityFailure(quality, fileRel) };

  const validation = validateGherkin(input.content);
  if (!validation.ok) {
    return {
      ok: false,
      message: [
        `Gherkin 语法错误,拒绝写入 ${fileRel}:`,
        ...validation.errors.map((e) => `  line ${e.line}: ${e.message}`),
      ].join("\n"),
    };
  }

  return {
    ok: true,
    featureName: validation.featureName ?? "",
    scenarioCount: validation.scenarioCount ?? 0,
  };
}

function resolveTargetFile(
  projectRoot: string,
  specDirAbs: string,
  file: string,
  kind: "capability" | "flow",
  targets: readonly string[],
  workspaceTarget?: string,
): { ok: true; abs: string; fileRel: string } | { ok: false; message: string } {
  if (isAbsolute(file)) return { ok: false, message: "file 必须是 spec_dir 内的相对路径" };
  if (file.includes("\\")) return { ok: false, message: "file 不能包含反斜杠,请使用 / 分隔路径" };
  if (!file.endsWith(".feature")) return { ok: false, message: "file 必须以 .feature 结尾" };
  const segments = file.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { ok: false, message: "file 不能包含空路径段、. 或 .." };
  }
  const target = segments[1];
  if (kind === "capability" && (segments[0] !== "features" || segments.length < 4)) {
    return { ok: false, message: "业务 feature 必须放在 features/<target>/<domain>/ 下" };
  }
  if (kind === "flow" && (segments[0] !== "flows" || segments.length < 4)) {
    return { ok: false, message: "flow feature 必须放在 flows/<target>/<domain>/ 下" };
  }
  if (!target || !targets.includes(target)) {
    return { ok: false, message: `file target "${target ?? ""}" 未在 harness.yaml targets 中声明` };
  }
  if (workspaceTarget && target !== workspaceTarget) {
    return { ok: false, message: `workspace.target=${workspaceTarget} 不能写 target ${target}` };
  }

  const abs = resolve(specDirAbs, file);
  const relToSpec = relative(specDirAbs, abs);
  if (!relToSpec || relToSpec.startsWith("..") || isAbsolute(relToSpec)) {
    return { ok: false, message: "file 必须是 spec_dir 内的相对路径" };
  }

  return { ok: true, abs, fileRel: relative(projectRoot, abs) };
}

function parseTargetedId(id: string): { target: string; domain: string } | null {
  const parts = id.split(".");
  if (parts.length < 3 || parts.some((part) => part.trim() === "")) return null;
  const [target, domain] = parts;
  if (!target || !domain) return null;
  return { target, domain };
}
