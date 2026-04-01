import { Type } from "@sinclair/typebox";
import type { MemberStore } from "../member-store.js";
import type { TeamModeConfig } from "../../api.js";
import { getTeamMemoryLastUpdated } from "../team-memory.js";

/**
 * team_status tool - returns a summary of the current team and member list.
 * Available to all roles.
 */
export function createTeamStatusTool(store: MemberStore, config: TeamModeConfig) {
  return {
    name: "team_status",
    description:
      "Show the current team status including team name, member list with roles, and team memory summary.",
    parameters: Type.Object({}),
    async execute() {
      const members = store.listMembers(config.teamId);
      const lastUpdated = getTeamMemoryLastUpdated(config.teamId);

      const memberLines = members.map(
        (m) => `- ${m.name} [${m.role}]`,
      );

      const memoryLine = lastUpdated
        ? `**Team Memory**: Last updated ${lastUpdated.toISOString().split("T")[0]}`
        : "**Team Memory**: No entries yet";

      const text = [
        `**Team**: ${config.teamName}`,
        `**Members** (${members.length}):`,
        ...memberLines,
        "",
        memoryLine,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    },
  };
}
