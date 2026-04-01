import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MemberStore } from "./src/member-store.js";
import { createBootstrapHook } from "./src/hooks/bootstrap.js";
import { createPromptHook } from "./src/hooks/prompt.js";
import { createToolGateHook } from "./src/hooks/tool-gate.js";
import { createMessageHook } from "./src/hooks/message.js";
import { createTeamRememberTool } from "./src/tools/team-remember.js";
import { createTeamStatusTool } from "./src/tools/team-status.js";
import { createTeamInviteTool } from "./src/tools/team-invite.js";
import { createJoinCommand } from "./src/join-handler.js";
import type { TeamModeConfig } from "./api.js";

export default definePluginEntry({
  id: "team-mode",
  name: "Team Mode",
  description:
    "Extends OpenClaw with multi-user team support: member registry, layered memory, and role-based permissions.",

  register(api) {
    const config = api.pluginConfig as TeamModeConfig;
    if (!config.teamId || !config.teamName) {
      api.logger.warn(
        "Team Mode: teamId and teamName are required. Run `openclaw team init` to set up.",
      );
      registerCliOnly(api);
      return;
    }

    const store = new MemberStore(config.teamId);
    const sharedMemoryMaxChars = config.sharedMemoryMaxChars ?? 1000;
    const requireJoinBeforeChat = config.requireJoinBeforeChat ?? true;

    // --- Hooks ---
    api.registerHook(
      ["agent:bootstrap"],
      createBootstrapHook(store, config),
    );

    api.registerHook(
      ["before_prompt_build"],
      createPromptHook(store, config, sharedMemoryMaxChars),
    );

    api.registerHook(
      ["before_tool_call"],
      createToolGateHook(store),
    );

    api.registerHook(
      ["message_received"],
      createMessageHook(store, config, requireJoinBeforeChat),
    );

    // --- Tools ---
    const rememberTool = createTeamRememberTool(store, config);
    api.registerTool(rememberTool);

    const statusTool = createTeamStatusTool(store, config);
    api.registerTool(statusTool);

    const inviteTool = createTeamInviteTool(store, config);
    api.registerTool(inviteTool);

    // --- Slash command: /team join ---
    const joinCommand = createJoinCommand(store, config);
    api.registerCommand(joinCommand);

    // --- CLI ---
    registerCliOnly(api);
  },
});

function registerCliOnly(api: Parameters<Parameters<typeof definePluginEntry>[0]["register"]>[0]) {
  api.registerCli(
    async ({ program }) => {
      const { registerTeamCli } = await import("./src/cli.js");
      registerTeamCli({ program, pluginConfig: api.pluginConfig as TeamModeConfig, runtime: api.runtime, logger: api.logger });
    },
    {
      descriptors: [
        {
          name: "team",
          description: "Manage team members, invites, memory, and configuration",
          hasSubcommands: true,
        },
      ],
    },
  );
}
