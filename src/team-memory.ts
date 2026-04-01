import { readFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export function getTeamDir(teamId: string): string {
  return join(homedir(), ".openclaw", "team", teamId);
}

export function getTeamMemoryPath(teamId: string): string {
  return join(getTeamDir(teamId), "TEAM_MEMORY.md");
}

export function readTeamMemory(teamId: string, maxChars?: number): string {
  const memPath = getTeamMemoryPath(teamId);
  try {
    const content = readFileSync(memPath, "utf-8");
    if (!content.trim()) return "";
    if (maxChars != null && content.length > maxChars) {
      return content.slice(0, maxChars) + "\n...(truncated)";
    }
    return content;
  } catch {
    return "";
  }
}

export function appendTeamMemory(
  teamId: string,
  entry: { content: string; category?: string; authorName: string },
): void {
  const memPath = getTeamMemoryPath(teamId);
  mkdirSync(dirname(memPath), { recursive: true });

  const category = entry.category ?? "general";
  const date = new Date().toISOString().split("T")[0];
  const block = `\n## ${category} \u2014 ${date} (by ${entry.authorName})\n\n${entry.content}\n`;

  appendFileSync(memPath, block, "utf-8");
}

export function getTeamMemoryLastUpdated(teamId: string): Date | null {
  try {
    const stats = statSync(getTeamMemoryPath(teamId));
    return stats.mtime;
  } catch {
    return null;
  }
}
