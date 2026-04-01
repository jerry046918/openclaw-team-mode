import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Member } from "../api.js";
import type { MemberStore } from "./member-store.js";
import { getTeamDir } from "./team-memory.js";

const OPENCLAW_DIR = join(homedir(), ".openclaw");

export function getAgentDir(memberId: string): string {
  return join(OPENCLAW_DIR, "agents", `tm-${memberId}`);
}

export function buildAgentEntry(member: Member) {
  const base = getAgentDir(member.id);
  return {
    id: member.agentId,
    workspace: join(base, "workspace"),
    agentDir: join(base, "agent"),
  };
}

export function buildBindingEntry(
  member: Member,
  channel: string,
  senderId: string,
) {
  return {
    agentId: member.agentId,
    match: {
      channel,
      peer: { kind: "direct" as const, id: senderId },
    },
  };
}

/**
 * Create the per-member agent workspace directory with bootstrap files.
 * Looks for team templates in ~/.openclaw/team/{teamId}/templates/ first,
 * falls back to minimal stubs.
 */
export function provisionWorkspace(memberId: string, teamId: string): void {
  const base = getAgentDir(memberId);
  const workspaceDir = join(base, "workspace");
  const memoryDir = join(workspaceDir, "memory");
  const agentDir = join(base, "agent");
  const sessionsDir = join(base, "sessions");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  const templateDir = join(getTeamDir(teamId), "templates");

  writeBootstrapFile(workspaceDir, templateDir, "AGENTS.md", DEFAULT_AGENTS_MD);
  writeBootstrapFile(workspaceDir, templateDir, "SOUL.md", DEFAULT_SOUL_MD);

  // Initialize empty sessions store
  const sessionsJson = join(sessionsDir, "sessions.json");
  if (!existsSync(sessionsJson)) {
    writeFileSync(sessionsJson, "{}", "utf-8");
  }
}

function writeBootstrapFile(
  workspaceDir: string,
  templateDir: string,
  filename: string,
  fallbackContent: string,
): void {
  const dest = join(workspaceDir, filename);
  if (existsSync(dest)) return; // don't overwrite existing files

  const templatePath = join(templateDir, filename);
  try {
    const content = readFileSync(templatePath, "utf-8");
    writeFileSync(dest, content, "utf-8");
  } catch {
    writeFileSync(dest, fallbackContent, "utf-8");
  }
}

/**
 * Read openclaw.json, merge all team member agents + bindings, write back.
 * Returns a diff summary of what changed.
 */
export function applyConfig(
  teamId: string,
  store: MemberStore,
): { added: string[]; existing: string[]; configPath: string } {
  const configPath = join(OPENCLAW_DIR, "openclaw.json");
  let config: any;

  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    config = {};
  }

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];
  if (!config.bindings) config.bindings = [];

  const existingAgentIds = new Set<string>(
    config.agents.list.map((a: any) => a.id),
  );
  const existingBindingKeys = new Set<string>(
    config.bindings.map((b: any) => `${b.agentId}:${b.match?.channel}:${b.match?.peer?.id}`),
  );

  const members = store.listMembers(teamId);
  const added: string[] = [];
  const existing: string[] = [];

  for (const member of members) {
    const agentEntry = buildAgentEntry(member);

    if (existingAgentIds.has(agentEntry.id)) {
      existing.push(`agent:${agentEntry.id}`);
    } else {
      config.agents.list.push(agentEntry);
      added.push(`agent:${agentEntry.id}`);
    }

    const identities = store.getIdentities(member.id);
    for (const identity of identities) {
      const binding = buildBindingEntry(member, identity.channel, identity.senderId);
      const key = `${binding.agentId}:${binding.match.channel}:${binding.match.peer.id}`;

      if (existingBindingKeys.has(key)) {
        existing.push(`binding:${key}`);
      } else {
        config.bindings.push(binding);
        added.push(`binding:${key}`);
      }
    }
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  return { added, existing, configPath };
}

const DEFAULT_AGENTS_MD = `# Agent Configuration

This agent is managed by the Team Mode plugin.
It provides a personal AI assistant for a team member.
`;

const DEFAULT_SOUL_MD = `# Identity

You are a helpful AI assistant serving a team member.
Be concise, accurate, and helpful. Respect team conventions
documented in the team shared memory.
`;
