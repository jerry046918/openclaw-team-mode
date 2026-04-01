// Setup entry for lightweight loading (disabled/unconfigured state).
// For non-channel plugins, this is a minimal re-export of the main entry
// that only registers CLI metadata without activating runtime hooks/tools.

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { TeamModeConfig } from "./api.js";

export default definePluginEntry({
  id: "team-mode",
  name: "Team Mode",
  description:
    "Extends OpenClaw with multi-user team support: member registry, layered memory, and role-based permissions.",

  register(api) {
    // Setup-only: register CLI descriptors so `openclaw team init` works
    // even before the plugin is fully configured.
    api.registerCli(
      async ({ program }) => {
        const { registerTeamCli } = await import("./src/cli.js");
        registerTeamCli({
          program,
          pluginConfig: api.pluginConfig as TeamModeConfig,
          runtime: api.runtime,
          logger: api.logger,
        });
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
  },
});
