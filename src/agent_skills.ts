/**
 * Project-local Agent Skill index.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { scanFiles } from "./glob.ts";

export interface AgentSkillIndexItem {
  name: string;
  file: string;
  description?: string;
}

export async function discoverAgentSkills(
  projectRoot: string,
  specDirAbs: string,
): Promise<AgentSkillIndexItem[]> {
  const skillsDir = resolve(specDirAbs, "agent-skills");
  if (!existsSync(skillsDir)) return [];

  const skills: AgentSkillIndexItem[] = [];
  for (const rel of await scanFiles(skillsDir, "*/SKILL.md")) {
    const [name] = rel.split("/");
    if (!name) continue;

    const abs = resolve(skillsDir, rel);
    skills.push({
      name,
      file: relative(projectRoot, abs),
      description: await readFrontmatterDescription(abs),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function readFrontmatterDescription(path: string): Promise<string | undefined> {
  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return undefined;
  }

  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatter) return undefined;

  try {
    const parsed = parseYaml(frontmatter) as { description?: unknown } | null;
    return typeof parsed?.description === "string" && parsed.description.trim()
      ? parsed.description.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
