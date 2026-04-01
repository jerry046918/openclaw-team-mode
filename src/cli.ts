import { MemberStore } from "./member-store.js";
import { readTeamMemory, getTeamMemoryLastUpdated } from "./team-memory.js";
import { provisionWorkspace, applyConfig } from "./agent-provisioner.js";
import type { TeamModeConfig } from "../api.js";

interface CliContext {
  program: any;
  pluginConfig: TeamModeConfig;
  runtime: any;
  logger: any;
}

export function registerTeamCli(ctx: CliContext): void {
  const { program } = ctx;

  const team = program
    .command("team")
    .description("Manage team members, invites, memory, and configuration");

  registerInit(team, ctx);
  registerStatus(team, ctx);
  registerMembers(team, ctx);
  registerInvite(team, ctx);
  registerApplyConfig(team, ctx);
}

// --- openclaw team init ---
function registerInit(parent: any, ctx: CliContext): void {
  parent
    .command("init")
    .description("Create a new team on this gateway instance")
    .option("--team-name <name>", "Team name")
    .option("--admin-name <name>", "Your name (first admin)")
    .option("--channel <channel>", "Your primary channel (e.g. telegram, discord)")
    .option("--sender-id <id>", "Your sender ID on that channel")
    .action(async (opts: any) => {
      const teamName: string = opts.teamName ?? await promptInput("Team name: ");
      const adminName: string = opts.adminName ?? await promptInput("Your name (first admin): ");
      const channel: string = opts.channel ?? await promptInput("Your primary channel (telegram/discord/slack): ");
      const senderId: string = opts.senderId ?? await promptInput("Your sender ID on that channel: ");

      const teamId = teamName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const store = new MemberStore(teamId);

      // Create team
      const team = {
        id: teamId,
        name: teamName,
        createdAt: new Date().toISOString(),
      };
      store.createTeam(team);

      // Create first admin
      const memberId = MemberStore.generateId();
      const agentId = `tm-${memberId}`;
      const member = {
        id: memberId,
        teamId,
        name: adminName,
        role: "admin" as const,
        agentId,
        createdAt: new Date().toISOString(),
      };
      store.createMember(member);
      store.addIdentity(memberId, channel, senderId);

      // Provision workspace
      provisionWorkspace(memberId, teamId);

      console.log("");
      console.log(`Team "${teamName}" created (id: ${teamId})`);
      console.log(`Admin "${adminName}" registered with agent ${agentId}`);
      console.log("");
      console.log("Next steps:");
      console.log(`  1. Add to your openclaw.json plugin config:`);
      console.log(`     "team-mode": { "enabled": true, "config": { "teamId": "${teamId}", "teamName": "${teamName}" } }`);
      console.log(`  2. Run: openclaw team apply-config`);
      console.log(`  3. Restart the gateway`);

      store.close();
    });
}

// --- openclaw team status ---
function registerStatus(parent: any, ctx: CliContext): void {
  parent
    .command("status")
    .description("Display team name, member count, and team memory summary")
    .action(async () => {
      const config = ctx.pluginConfig;
      if (!config.teamId) {
        console.log("Team Mode is not configured. Run: openclaw team init");
        return;
      }

      const store = new MemberStore(config.teamId);
      const team = store.getTeam(config.teamId);
      if (!team) {
        console.log(`Team "${config.teamId}" not found in database.`);
        store.close();
        return;
      }

      const members = store.listMembers(config.teamId);
      const lastUpdated = getTeamMemoryLastUpdated(config.teamId);

      console.log(`Team: ${team.name}`);
      console.log(`Members: ${members.length}`);
      console.log(
        `Team Memory: ${lastUpdated ? `Last updated ${lastUpdated.toISOString().split("T")[0]}` : "No entries yet"}`,
      );

      store.close();
    });
}

// --- openclaw team members ---
function registerMembers(parent: any, ctx: CliContext): void {
  parent
    .command("members")
    .description("List all team members with their roles and identities")
    .option("--json", "Output as JSON")
    .action(async (opts: any) => {
      const config = ctx.pluginConfig;
      if (!config.teamId) {
        console.log("Team Mode is not configured. Run: openclaw team init");
        return;
      }

      const store = new MemberStore(config.teamId);
      const members = store.listMembers(config.teamId);

      if (opts.json) {
        const output = members.map((m) => ({
          ...m,
          identities: store.getIdentities(m.id),
        }));
        console.log(JSON.stringify(output, null, 2));
        store.close();
        return;
      }

      if (members.length === 0) {
        console.log("No members registered.");
        store.close();
        return;
      }

      for (const m of members) {
        const identities = store.getIdentities(m.id);
        const idStr = identities
          .map((i) => `${i.channel}:${i.senderId}`)
          .join(", ");
        console.log(`  ${m.name} [${m.role}] (${idStr})`);
      }

      store.close();
    });
}

// --- openclaw team invite ---
function registerInvite(parent: any, ctx: CliContext): void {
  parent
    .command("invite")
    .description("Generate a one-time invite code (24h expiry)")
    .option("--role <role>", "Role for the invitee (admin|member)", "member")
    .option("--note <note>", "Optional context about the invitee")
    .action(async (opts: any) => {
      const config = ctx.pluginConfig;
      if (!config.teamId) {
        console.log("Team Mode is not configured. Run: openclaw team init");
        return;
      }

      const store = new MemberStore(config.teamId);
      const members = store.listMembers(config.teamId);
      const admins = members.filter((m) => m.role === "admin");

      if (admins.length === 0) {
        console.log("No admin found. Cannot create invite.");
        store.close();
        return;
      }

      store.cleanExpiredInvites();

      const code = MemberStore.generateInviteCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      store.createInvite({
        code,
        teamId: config.teamId,
        role: opts.role as "admin" | "member",
        createdBy: admins[0].id,
        expiresAt,
      });

      console.log("");
      console.log(`Invite code: ${code}`);
      console.log(`Role: ${opts.role}`);
      console.log(`Expires: ${expiresAt}`);
      console.log("");
      console.log(`Send this to the invitee:`);
      console.log(`  /team join ${code}`);
      console.log("");

      store.close();
    });
}

// --- openclaw team apply-config ---
function registerApplyConfig(parent: any, ctx: CliContext): void {
  parent
    .command("apply-config")
    .description("Write pending agent/binding entries to openclaw.json")
    .action(async () => {
      const config = ctx.pluginConfig;
      if (!config.teamId) {
        console.log("Team Mode is not configured. Run: openclaw team init");
        return;
      }

      const store = new MemberStore(config.teamId);
      const result = applyConfig(config.teamId, store);

      if (result.added.length === 0) {
        console.log("No new entries to add. Config is up to date.");
      } else {
        console.log(`Updated ${result.configPath}:`);
        console.log("");
        for (const entry of result.added) {
          console.log(`  + ${entry}`);
        }
        if (result.existing.length > 0) {
          console.log("");
          for (const entry of result.existing) {
            console.log(`  = ${entry} (already present)`);
          }
        }
        console.log("");
        console.log("Restart the gateway to apply changes.");
      }

      store.close();
    });
}

// Simple stdin prompt fallback
async function promptInput(question: string): Promise<string> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
