import type { MemberStore } from "../member-store.js";
import type { TeamModeConfig } from "../../api.js";
import { readTeamMemory } from "../team-memory.js";
import { buildPrependContext } from "../prompt-builder.js";

const TEAM_AGENT_PREFIX = "tm-";

/**
 * before_prompt_build hook - injects team shared memory and role instructions
 * into every agent run via prependContext.
 */
export function createPromptHook(
  store: MemberStore,
  config: TeamModeConfig,
  sharedMemoryMaxChars: number,
) {
  return async (event: any) => {
    const sessionKey: string | undefined =
      event.context?.sessionKey ?? event.sessionKey;
    if (!sessionKey) return {};

    const agentId = parseAgentId(sessionKey);
    if (!agentId || !agentId.startsWith(TEAM_AGENT_PREFIX)) return {};

    const member = store.getMemberByAgentId(agentId);
    if (!member) return {};

    const team = store.getTeam(config.teamId);
    if (!team) return {};

    const teamMemorySummary = readTeamMemory(config.teamId, sharedMemoryMaxChars);
    const prependContext = buildPrependContext(member, team, teamMemorySummary);

    return { prependContext };
  };
}

function parseAgentId(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts.length >= 2) {
    return parts[1];
  }
  return undefined;
}
