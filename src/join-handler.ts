import type { MemberStore } from "./member-store.js";
import type { TeamModeConfig } from "../api.js";
import { provisionWorkspace } from "./agent-provisioner.js";

/**
 * Creates the /team command handler (slash command, bypasses LLM).
 * Handles: /team join <code>
 */
export function createJoinCommand(store: MemberStore, config: TeamModeConfig) {
  return {
    name: "team",
    description: "Team management commands. Use: /team join <code>",
    async execute(args: string, context: any) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (subcommand === "join") {
        return handleJoin(parts.slice(1).join(" "), store, config, context);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: "Available commands:\n- `/team join <CODE>` \u2014 Join the team with an invite code",
          },
        ],
      };
    },
  };
}

async function handleJoin(
  codeArg: string,
  store: MemberStore,
  config: TeamModeConfig,
  context: any,
) {
  const code = codeArg.trim().toUpperCase();

  if (!code) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Usage: `/team join <CODE>`\nAsk a team admin for an invite code.",
        },
      ],
    };
  }

  // Validate invite
  const invite = store.getInvite(code);
  if (!invite) {
    return {
      content: [
        { type: "text" as const, text: `Invalid invite code: ${code}` },
      ],
    };
  }

  if (invite.usedBy) {
    return {
      content: [
        { type: "text" as const, text: "This invite code has already been used." },
      ],
    };
  }

  if (new Date(invite.expiresAt) < new Date()) {
    return {
      content: [
        { type: "text" as const, text: "This invite code has expired. Ask an admin for a new one." },
      ],
    };
  }

  // Extract sender info from context
  const channelId: string | undefined =
    context?.channelId ?? context?.metadata?.channelId;
  const senderId: string | undefined =
    context?.from ?? context?.senderId ?? context?.metadata?.senderId;

  if (!channelId || !senderId) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Could not determine your identity. Please try again from a supported channel.",
        },
      ],
    };
  }

  // Check if sender is already registered
  const existingMember = store.getMemberBySenderId(channelId, senderId);
  if (existingMember) {
    // Already a member - just acknowledge
    return {
      content: [
        {
          type: "text" as const,
          text: `You're already a member of **${config.teamName}** as ${existingMember.name} [${existingMember.role}].`,
        },
      ],
    };
  }

  // Create new member
  const memberId = MemberStore.generateId();
  const agentId = `tm-${memberId}`;

  // Use sender name from context if available, otherwise derive from senderId
  const name: string =
    context?.metadata?.senderName ??
    context?.metadata?.senderUsername ??
    senderId;

  const member = {
    id: memberId,
    teamId: config.teamId,
    name,
    role: invite.role,
    agentId,
    createdAt: new Date().toISOString(),
    notes: invite.code ? undefined : undefined, // could attach invite note here in future
  };

  store.createMember(member);
  store.addIdentity(memberId, channelId, senderId);
  store.redeemInvite(code, memberId);

  // Provision the agent workspace
  provisionWorkspace(memberId, config.teamId);

  return {
    content: [
      {
        type: "text" as const,
        text:
          `Welcome to **${config.teamName}**, ${name}! You've joined as a **${invite.role}**.\n\n` +
          `A team admin needs to run \`openclaw team apply-config\` and restart the gateway ` +
          `to activate your personal agent.`,
      },
    ],
  };
}
