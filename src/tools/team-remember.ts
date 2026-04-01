import { Type } from "@sinclair/typebox";
import type { MemberStore } from "../member-store.js";
import type { TeamModeConfig } from "../../api.js";
import { appendTeamMemory } from "../team-memory.js";

/**
 * team_remember tool - writes a new entry to team shared memory.
 * Admin only (also enforced by before_tool_call hook).
 */
export function createTeamRememberTool(store: MemberStore, config: TeamModeConfig) {
  return {
    name: "team_remember",
    description:
      "Write information to the team's shared memory. Use when an admin says 'remember that...' or 'add to team memory'. Admin only.",
    parameters: Type.Object({
      content: Type.String({
        description: "The information to remember at the team level",
      }),
      category: Type.Optional(
        Type.Union([
          Type.Literal("decision"),
          Type.Literal("convention"),
          Type.Literal("project"),
          Type.Literal("general"),
        ]),
      ),
    }),
    async execute(
      _id: string,
      params: { content: string; category?: "decision" | "convention" | "project" | "general" },
      context?: any,
    ) {
      // Resolve the calling member for attribution
      const agentId = parseAgentIdFromContext(context);
      let authorName = "Unknown";
      if (agentId) {
        const member = store.getMemberByAgentId(agentId);
        if (member) {
          authorName = member.name;
        }
      }

      appendTeamMemory(config.teamId, {
        content: params.content,
        category: params.category,
        authorName,
      });

      const category = params.category ?? "general";
      return {
        content: [
          {
            type: "text" as const,
            text: `Added to team memory under "${category}" by ${authorName}.`,
          },
        ],
      };
    },
  };
}

function parseAgentIdFromContext(context: any): string | undefined {
  const sessionKey: string | undefined = context?.sessionKey;
  if (!sessionKey) return undefined;
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts.length >= 2) {
    return parts[1];
  }
  return undefined;
}
