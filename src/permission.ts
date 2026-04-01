import type { Member } from "../api.js";

export const ADMIN_ONLY_TOOLS = [
  "team_invite",
  "team_remove",
  "team_remember",
  "team_set_role",
] as const;

export function isAdminOnlyTool(toolName: string): boolean {
  return (ADMIN_ONLY_TOOLS as readonly string[]).includes(toolName);
}

export function canUseTool(
  member: Member,
  toolName: string,
): { allowed: boolean; reason?: string } {
  if (!isAdminOnlyTool(toolName)) {
    return { allowed: true };
  }
  if (member.role === "admin") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Only admins can use ${toolName}. Your current role is "${member.role}".`,
  };
}
