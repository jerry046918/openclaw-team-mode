import type { MemberStore } from "../member-store.js";
import type { TeamModeConfig } from "../../api.js";
import { buildUserMd } from "../prompt-builder.js";

const TEAM_AGENT_PREFIX = "tm-";

/**
 * agent:bootstrap hook - replaces USER.md with member-specific content
 * before bootstrap files are injected into the system prompt.
 *
 * bootstrapFiles is mutated in-place; the replacement is ephemeral, per-run only.
 */
export function createBootstrapHook(store: MemberStore, config: TeamModeConfig) {
  return async (event: any) => {
    const sessionKey: string | undefined =
      event.context?.sessionKey ?? event.sessionKey;
    if (!sessionKey) return;

    // Parse agentId from sessionKey: "agent:{agentId}:{rest}"
    const agentId = parseAgentId(sessionKey);
    if (!agentId || !agentId.startsWith(TEAM_AGENT_PREFIX)) return;

    const member = store.getMemberByAgentId(agentId);
    if (!member) return;

    const team = store.getTeam(config.teamId);
    if (!team) return;

    const userMdContent = buildUserMd(member, team);

    const bootstrapFiles: Array<{ name: string; content: string }> | undefined =
      event.context?.bootstrapFiles;
    if (!bootstrapFiles) return;

    const existing = bootstrapFiles.find(
      (f) => f.name === "USER.md" || f.name.endsWith("/USER.md"),
    );
    if (existing) {
      existing.content = userMdContent;
    } else {
      bootstrapFiles.push({ name: "USER.md", content: userMdContent });
    }
  };
}

function parseAgentId(sessionKey: string): string | undefined {
  // Format: "agent:{agentId}:{rest}"
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts.length >= 2) {
    return parts[1];
  }
  return undefined;
}
