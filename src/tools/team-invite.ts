import { Type } from "@sinclair/typebox";
import type { MemberStore } from "../member-store.js";
import type { TeamModeConfig } from "../../api.js";

/**
 * team_invite tool - generates a one-time invite code.
 * Admin only (also enforced by before_tool_call hook).
 */
export function createTeamInviteTool(store: MemberStore, config: TeamModeConfig) {
  return {
    name: "team_invite",
    description:
      "Generate a one-time invite code for a new team member. The invitee sends `/team join <CODE>` to join. Admin only.",
    parameters: Type.Object({
      role: Type.Union([Type.Literal("admin"), Type.Literal("member")], {
        description: "Role to assign to the new member",
      }),
      note: Type.Optional(
        Type.String({
          description: "Optional context hint about the invitee",
        }),
      ),
    }),
    async execute(
      _id: string,
      params: { role: "admin" | "member"; note?: string },
      context?: any,
    ) {
      // Resolve the calling admin for createdBy
      const agentId = parseAgentIdFromContext(context);
      let creatorId = "unknown";
      if (agentId) {
        const member = store.getMemberByAgentId(agentId);
        if (member) {
          creatorId = member.id;
        }
      }

      // Clean up expired invites while we're here
      store.cleanExpiredInvites();

      const code = MemberStore.generateInviteCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      store.createInvite({
        code,
        teamId: config.teamId,
        role: params.role,
        createdBy: creatorId,
        expiresAt,
      });

      const text = `Invite code: **${code}** (expires in 24h, role: ${params.role}).\n` +
        `New member should send: \`/team join ${code}\``;

      return {
        content: [{ type: "text" as const, text }],
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
