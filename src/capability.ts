/**
 * 能力(capability)发现 — 扫描规格目录,解析 .feature 文件元信息。
 */
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { scanFiles } from "./glob.ts";

export interface Capability {
  /** 唯一标识 — 来自 # capability: 注释,缺失则用文件相对路径(去 .feature) */
  name: string;
  /** 绝对路径 */
  fileAbs: string;
  /** 相对项目根的路径 */
  fileRel: string;
  /** Gherkin 顶层 @tag(粗扫,不严格解析) */
  tags: string[];
  /** # files: 注释里关联的源码路径(可能为空) */
  filesLinked: string[];
  /** 功能/Feature 标题(取第一行 `功能:` 或 `Feature:` 后的文字) */
  title: string;
  /** 文件最后修改时间(ISO) */
  lastModified: string;
}

const CAP_RE = /^#\s*capability:\s*(.+)\s*$/m;
const FILES_RE = /^#\s*files:\s*(.+)\s*$/m;
const TITLE_RE = /^\s*(?:Feature|功能|功能性|Característica|機能):\s*(.+)$/m;
const NON_CAPABILITY_TOP_LEVEL_DIRS = new Set(["constraints", "flows"]);

export function isReservedSpecFeatureRel(rel: string): boolean {
  const segments = rel.split(/[\\/]+/);
  return (
    segments.some((seg) => seg.startsWith("_")) ||
    NON_CAPABILITY_TOP_LEVEL_DIRS.has(segments[0] ?? "")
  );
}

/**
 * 扫描 specDirAbs 下所有 .feature 文件,排除 charterDirAbs 下的(它们是宪法,不是能力)。
 */
export async function discoverCapabilities(
  projectRoot: string,
  specDirAbs: string,
  charterDirAbs: string,
): Promise<Capability[]> {
  if (!existsSync(specDirAbs)) {
    return [];
  }

  const result: Capability[] = [];

  for (const rel of await scanFiles(specDirAbs, "**/*.feature")) {
    const abs = resolve(specDirAbs, rel);
    // charter 目录跳过
    if (abs.startsWith(charterDirAbs + "/")) continue;
    // _、constraints、flows 是特殊规格文件,不是业务能力。
    if (isReservedSpecFeatureRel(rel)) continue;

    const cap = await readCapability(abs, projectRoot);
    result.push(cap);
  }

  // 名称排序,稳定输出
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/**
 * 读取单个 .feature 提取元信息。失败时降级:
 * - 没 # capability: 注释 → 用相对路径(去后缀)做 name
 * - 没 # files: 注释 → 空数组
 * - 没标题 → 空字符串
 */
export async function readCapability(
  abs: string,
  projectRoot: string,
): Promise<Capability> {
  const content = await readFile(abs, "utf-8");
  const st = await stat(abs);

  const capMatch = content.match(CAP_RE);
  const filesMatch = content.match(FILES_RE);
  const titleMatch = content.match(TITLE_RE);

  const fileRel = relative(projectRoot, abs);
  const fallbackName = fileRel.replace(/\.feature$/, "");
  const name = capMatch?.[1]?.trim() ?? fallbackName;

  const filesLinked = filesMatch?.[1]
    ? filesMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const tags = extractTopLevelTags(content);

  return {
    name,
    fileAbs: abs,
    fileRel,
    tags,
    filesLinked,
    title: titleMatch?.[1]?.trim() ?? "",
    lastModified: st.mtime.toISOString(),
  };
}

/**
 * 粗扫顶层 @tag — 在第一个 Feature/功能 行之前的 @ 开头单词。
 */
function extractTopLevelTags(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const tags: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("@")) {
      tags.push(...trimmed.split(/\s+/).filter((t) => t.startsWith("@")));
      continue;
    }
    // 一旦遇到 Feature/功能,停
    if (/^(?:Feature|功能|機能|Característica)\s*:/.test(trimmed)) break;
    // 其他非空非注释非 tag 行,也停(防御)
    break;
  }
  return tags;
}

/**
 * 模糊匹配:case-insensitive substring,匹配 name 或 fileRel。
 * 返回所有命中,调用方决定要 1 个还是多个。
 */
export function matchCapabilities(
  caps: Capability[],
  query: string,
): Capability[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return caps.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.fileRel.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q),
  );
}
