import type { MemberStore } from "../member-store.js";
import { isAdminOnlyTool } from "../permission.js";

const TEAM_AGENT_PREFIX = "tm-";

/**
 * before_tool_call hook - blocks admin-only tools for non-admin members.
 *
 * Decision semantics: { block: true } is terminal and stops lower-priority handlers.
 */
export function createToolGateHook(store: MemberStore) {
  return async (event: any) => {
    const toolName: string | undefined = event.toolName ?? event.context?.toolName;
    if (!toolName || !isAdminOnlyTool(toolName)) {
      return {};
    }

    const sessionKey: string | undefined =
      event.context?.sessionKey ?? event.sessionKey;
    if (!sessionKey) return {};

    const agentId = parseAgentId(sessionKey);
    if (!agentId || !agentId.startsWith(TEAM_AGENT_PREFIX)) return {};

    const member = store.getMemberByAgentId(agentId);
    if (!member) {
      return {
        block: true,
        blockReason: `Cannot identify team member for this session. Tool "${toolName}" requires admin access.`,
      };
    }

    if (member.role === "admin") {
      return {};
    }

    return {
      block: true,
      blockReason: `Only admins can use ${toolName}. Your current role is "${member.role}".`,
    };
  };
}

function parseAgentId(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts.length >= 2) {
    return parts[1];
  }
  return undefined;
}
