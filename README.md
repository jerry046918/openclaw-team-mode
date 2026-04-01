# Team Mode for OpenClaw

Turn a single-user OpenClaw gateway into a shared team assistant. Each team member gets their own isolated agent with private memory, while the whole team shares a common knowledge base and coordinated context.

## Why Team Mode

OpenClaw is built as a personal AI assistant -- one user, one gateway. That model breaks down when a team wants to share one instance:

- Everyone's DMs land in the same session, leaking context between people.
- There's one flat memory file, so the agent confuses Alice's project notes with Bob's.
- No way to know *who* is talking or what they're allowed to do.
- No shared team knowledge that persists across individual conversations.

Team Mode solves this by adding a thin identity and permission layer on top of OpenClaw's existing multi-agent infrastructure. It is designed for **cooperative teams inside a shared trust boundary** (a company, a lab, a studio) -- not for adversarial multi-tenancy.

## How It Works

```
                   OpenClaw Gateway
                   ================
                   
   Alice (Telegram)                   Bob (Discord)
        |                                  |
        v                                  v
   +-----------+                    +-----------+
   | tm-alice  |   <-- shared -->   |  tm-bob   |
   |  agent    |   team memory      |  agent    |
   +-----------+                    +-----------+
   | MEMORY.md |                    | MEMORY.md |   <-- private per member
   +-----------+                    +-----------+
        |                                  |
        +---------> TEAM_MEMORY.md <-------+          <-- shared, admin-writable
```

**Each member gets:**
- A dedicated OpenClaw agent (`tm-{memberId}`) with its own workspace
- Private conversation history and personal memory (`MEMORY.md`)
- A dynamically generated `USER.md` so the agent knows who it's serving

**The team shares:**
- `TEAM_MEMORY.md` -- long-term shared context injected into every prompt
- A member registry with role-based permissions (`admin` / `member`)
- Invite-based onboarding so new people can join from any channel

## Roles

| Capability | Admin | Member |
|---|:---:|:---:|
| Chat with the agent | Yes | Yes |
| View team status and member list | Yes | Yes |
| Write to team shared memory | Yes | -- |
| Invite new members | Yes | -- |
| Remove members | Yes | -- |
| Change member roles | Yes | -- |

The agent is told about each user's role in the system prompt and adjusts its behavior accordingly. Admin-only tools are also hard-blocked at the hook level, so a member can't trick the agent into running them.

## Quick Start

### 1. Install the plugin

```bash
# From a local directory
openclaw plugins install /path/to/openclaw-team-mode

# Or from a tarball
openclaw plugins install openclaw-team-mode-0.1.0.tgz
```

### 2. Initialize a team

```bash
openclaw team init
```

You'll be prompted for:
- **Team name** -- displayed to members and injected into prompts
- **Your name** -- you become the first admin
- **Channel** -- your primary messaging platform (`telegram`, `discord`, `slack`)
- **Sender ID** -- your sender ID on that channel

Or pass everything as flags:

```bash
openclaw team init \
  --team-name "Acme Engineering" \
  --admin-name "Alice" \
  --channel telegram \
  --sender-id "tg:123456789"
```

### 3. Enable the plugin in config

Add to your `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "team-mode": {
        enabled: true,
        config: {
          teamId: "acme-engineering",   // generated from team name
          teamName: "Acme Engineering"
        }
      }
    }
  }
}
```

### 4. Apply and restart

```bash
openclaw team apply-config    # writes agent + binding entries to openclaw.json
openclaw gateway restart      # activates the new agents
```

That's it -- you're chatting with your personal team agent.

## Inviting Team Members

### From the CLI

```bash
openclaw team invite --role member
# Output:
#   Invite code: XK7P2M
#   Send this to the invitee:
#     /team join XK7P2M
```

### From chat (admin only)

Just ask the agent:

> "Generate an invite code for a new team member"

The agent calls the `team_invite` tool and replies with the code.

### Joining

The invitee sends this message in any channel connected to the gateway:

```
/team join XK7P2M
```

Invite codes are 6 characters, valid for 24 hours, and single-use. After someone joins, an admin needs to run:

```bash
openclaw team apply-config
openclaw gateway restart
```

This registers the new member's agent and channel binding in the gateway config.

## Shared Team Memory

Team memory is a Markdown file (`TEAM_MEMORY.md`) that gets injected into every member's prompt. It's the team's long-term shared brain -- decisions, conventions, project context.

### Writing (admin only)

Ask the agent naturally:

> "Remember that we decided to use pnpm as our package manager"

> "Add to team memory: code reviews require two approvals"

The agent calls `team_remember` and appends a categorized entry:

```markdown
## convention -- 2026-04-01 (by Alice)

Code reviews require two approvals before merging.
```

Categories: `decision`, `convention`, `project`, `general`.

### Reading (everyone)

Team memory is automatically included in every prompt -- no action needed. The first 1000 characters (configurable) are injected as context on every turn.

Ask the agent about it:

> "What are our team conventions?"

> "What decisions have we made about the deployment process?"

## Multi-Channel Identity

A single team member can interact with the agent from multiple platforms. Their identity, memory, and permissions follow them across channels.

Bind an additional identity via CLI:

```bash
openclaw team identity add alice discord "discord:456789"
```

Now Alice gets the same agent whether she messages from Telegram or Discord.

## CLI Reference

All commands live under `openclaw team`:

| Command | Description |
|---|---|
| `team init` | Create a new team (interactive) |
| `team status` | Show team name, member count, memory summary |
| `team members` | List all members with roles and channel identities |
| `team members --json` | Same, as JSON |
| `team invite` | Generate a one-time invite code |
| `team invite --role admin` | Generate an admin invite |
| `team apply-config` | Merge agent/binding entries into `openclaw.json` |

## Agent Tools

These tools are registered and available to the agent during conversations:

| Tool | Access | Description |
|---|---|---|
| `team_status` | Everyone | Returns team name, member list, memory summary |
| `team_remember` | Admin | Appends an entry to team shared memory |
| `team_invite` | Admin | Generates a 6-char invite code (24h expiry) |

## Configuration

Full config reference under `plugins.entries["team-mode"].config`:

```json5
{
  teamId: "acme-eng",              // Required. Stable identifier, used in file paths.
  teamName: "Acme Engineering",    // Required. Displayed in prompts and messages.
  defaultRole: "member",           // Role assigned to new members. Default: "member".
  sharedMemoryMaxChars: 1000,      // Max chars of TEAM_MEMORY.md per prompt. Default: 1000.
  requireJoinBeforeChat: true      // Block unregistered senders. Default: true.
}
```

Team Mode also expects this gateway-level setting:

```json5
{
  session: {
    dmScope: "per-channel-peer"    // prevents cross-user session leakage
  }
}
```

## Data Storage

All team data lives under `~/.openclaw/`:

```
~/.openclaw/team/{teamId}/
  members.db              SQLite database (members, identities, invites)
  TEAM_MEMORY.md          Shared team memory

~/.openclaw/agents/tm-{memberId}/
  workspace/
    AGENTS.md             Agent configuration (from team template or stub)
    SOUL.md               Agent personality (from team template or stub)
    MEMORY.md             Personal memory (managed by OpenClaw)
  sessions/               Conversation history
  agent/                  Auth profiles
```

### Team Templates

Place template files in `~/.openclaw/team/{teamId}/templates/` to customize the agent persona for new members:

```
~/.openclaw/team/{teamId}/templates/
  AGENTS.md     # copied to each new member's workspace
  SOUL.md       # copied to each new member's workspace
```

If no templates exist, minimal stubs are generated.

## Security Model

Team Mode is designed for **trusted cooperative teams**, not hostile multi-tenancy.

- Members share a single gateway process and trust boundary.
- Admin-only tools are enforced by a `before_tool_call` hook (hard block), backed by role instructions in the prompt (soft guidance).
- The SQLite database uses WAL mode with transactional writes.
- Invite codes are 6-char alphanumeric (~2 billion combinations), single-use, and expire in 24 hours.
- Personal workspaces are directory-isolated but not sandboxed at the OS level.

For teams handling sensitive data, consider enabling `sandbox.mode: "all"` at the gateway level.

## Requirements

- OpenClaw `>= 2026.3.24-beta.2`
- Node.js `>= 22`
- `better-sqlite3` native dependency (compiles automatically on most platforms; Linux/macOS may need `python3`, `make`, `g++`)
