import fg from "fast-glob";
import { minimatch } from "minimatch";

export async function scanFiles(cwd: string, pattern: string): Promise<string[]> {
  const files = await fg(pattern, {
    cwd,
    dot: true,
    onlyFiles: true,
    unique: true,
  });
  return files.map(normalizePath).sort();
}

export function matchesGlob(path: string, pattern: string): boolean {
  return minimatch(normalizePath(path), pattern, { dot: true });
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
