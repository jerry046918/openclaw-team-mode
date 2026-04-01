import type { MemberStore } from "../member-store.js";
import type { TeamModeConfig } from "../../api.js";

/**
 * message_received hook - fires for every inbound message (parallel/fire-and-forget).
 *
 * When requireJoinBeforeChat is true, pushes join instructions to unregistered
 * senders via event.messages. This is a soft gate; true blocking requires the
 * inbound_claim hook (Phase 2).
 */
export function createMessageHook(
  store: MemberStore,
  config: TeamModeConfig,
  requireJoinBeforeChat: boolean,
) {
  return async (event: any) => {
    if (!requireJoinBeforeChat) return;

    const channelId: string | undefined =
      event.context?.channelId;
    const senderId: string | undefined =
      event.context?.from ?? event.context?.metadata?.senderId;

    if (!channelId || !senderId) return;

    const member = store.getMemberBySenderId(channelId, senderId);
    if (member) return; // already registered

    const teamName = config.teamName;
    event.messages?.push(
      `You are not registered with **${teamName}**. ` +
      `Ask a team admin for an invite code, then send:\n` +
      `\`/team join <CODE>\``,
    );
  };
}
