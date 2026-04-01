import type { Member, Team } from "../api.js";

export function buildUserMd(member: Member, team: Team): string {
  const isAdmin = member.role === "admin";
  const notesLine = member.notes ? `\n**Context**: ${member.notes}` : "";

  const adminCommands = isAdmin
    ? `\n- \`/team invite\` \u2014 Generate an invite code\n- \`/team remove <name>\` \u2014 Remove a member`
    : "";

  return `# User Profile

**Name**: ${member.name}
**Role**: ${member.role}
**Team**: ${team.name}
**Member ID**: ${member.id}${notesLine}

## Permissions
- Manage team members: ${isAdmin ? "YES" : "NO"}
- Write to team memory: ${isAdmin ? "YES" : "NO"}
- Modify team configuration: ${isAdmin ? "YES" : "NO"}

## Available Team Commands
- \`/team status\` \u2014 Show team members and current context
- \`/team memory\` \u2014 Search team shared memory${adminCommands}
`;
}

export function getRoleInstructions(role: "admin" | "member"): string {
  if (role === "admin") {
    return `You are serving a TEAM ADMIN. They have full permissions including:
- Inviting and removing team members
- Writing decisions and conventions to team shared memory via team_remember
- Viewing all member activity

When they use commands like /team invite or ask about member management, assist fully.`;
  }

  return `You are serving a TEAM MEMBER with standard access.
They cannot modify team membership or write to shared team memory.
If they request admin-only actions, explain politely that admin permission is required.`;
}

export function buildPrependContext(
  member: Member,
  team: Team,
  teamMemorySummary: string,
): string {
  const roleInstructions = getRoleInstructions(member.role);

  const memoryBlock = teamMemorySummary.trim()
    ? `\n<team_shared_memory>\n${teamMemorySummary}\n</team_shared_memory>`
    : "";

  return `<team_context>
<team_name>${team.name}</team_name>
<current_user role="${member.role}">${member.name}</current_user>${memoryBlock}
<role_instructions>
${roleInstructions}
</role_instructions>
</team_context>`;
}
