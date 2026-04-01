# openclaw-team-mode — Plugin Specification

> Version: 0.1.0-draft  
> Status: Pre-development  
> Last updated: 2026-03-31

---

## 1. Background & Motivation

OpenClaw is designed as a **personal AI assistant** for a single trusted operator. Its
security model, memory system, and session routing all assume one user per gateway
instance. When a team needs a shared AI agent, several gaps appear:

| Gap | Root Cause |
|-----|-----------|
| All DMs share one session by default | `session.dmScope` defaults to `"main"` |
| Memory is a single flat workspace | One `MEMORY.md` per agent, no team layer |
| No user identity concept | OpenClaw tracks sender IDs but has no member registry |
| No role-based tool gating | Tool policy is global or per-agent, not per-sender |
| No cross-user shared context | Each agent workspace is fully isolated |

This plugin adds a **Team Mode** layer on top of OpenClaw's existing multi-agent and
session infrastructure, enabling a single gateway instance to serve a trusted team with:

- Per-member identity and session isolation
- Layered memory (personal / team-shared)
- Role-based permission enforcement (admin / member)
- Dynamic prompt context that tells the agent who it is serving

**Out of scope:** hostile multi-tenant isolation. OpenClaw's own security docs state it
is not designed for adversarial users sharing one gateway. This plugin targets
cooperative teams inside a shared trust boundary (e.g., a company team).

> Official security model reference:  
> https://docs.openclaw.ai/gateway/security/index.md

---

## 2. Goals

1. **Member registry** — map channel sender IDs (Telegram, Discord, Slack, etc.) to
   named team members with roles.
2. **Per-member session isolation** — each member gets their own conversation history,
   no cross-user context leakage.
3. **Layered memory** — personal memory is private; team-shared memory is visible to
   all members and writable by admins.
4. **Role-aware prompt injection** — the agent knows who it is talking to, what they
   are allowed to do, and what the team's shared context is, before the first message.
5. **Permission enforcement** — admin-only tools are blocked for regular members via a
   `before_tool_call` hook.
6. **Multi-channel identity** — one member can be identified across Telegram, Discord,
   Slack, etc. by binding multiple sender IDs to the same member record.
7. **CLI management** — `openclaw team` subcommands for day-to-day administration.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  OpenClaw Gateway                       │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Team Mode Plugin                    │  │
│  │                                                  │  │
│  │  ┌─────────────┐   ┌──────────────────────────┐ │  │
│  │  │ Member Store│   │   Hook Registry          │ │  │
│  │  │  (SQLite)   │   │  agent:bootstrap         │ │  │
│  │  │             │   │  before_prompt_build     │ │  │
│  │  │ members     │   │  before_tool_call        │ │  │
│  │  │ identities  │   │  message_received        │ │  │
│  │  │ teams       │   └──────────────────────────┘ │  │
│  │  └─────────────┘                                 │  │
│  │                                                  │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │           Tool Registration              │   │  │
│  │  │  team_remember  team_status              │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │                                                  │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │        HTTP Route (Admin API)            │   │  │
│  │  │  POST /team/members   GET /team/status   │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Per-member agents (provisioned at member join time)    │
│  ~/.openclaw/agents/tm-{memberId}/                      │
│    workspace/  sessions/  agent/                        │
└─────────────────────────────────────────────────────────┘
```

---

## 4. File & Directory Layout

### 4.1 Plugin package

```
openclaw-team-mode/
├── package.json               # Plugin manifest metadata (see §6.1)
├── openclaw.plugin.json       # OpenClaw plugin manifest (see §6.2)
├── index.ts                   # definePluginEntry — full runtime
├── setup-entry.ts             # defineSetupPluginEntry — onboarding only
├── api.ts                     # Public type exports
├── runtime-api.ts             # Internal runtime exports
└── src/
    ├── member-store.ts        # SQLite member/identity/team persistence
    ├── team-memory.ts         # Shared memory read/write helpers
    ├── prompt-builder.ts      # Builds prependContext and USER.md content
    ├── permission.ts          # Role definitions and tool-gate logic
    ├── agent-provisioner.ts   # Creates per-member agent config fragments
    ├── cli.ts                 # `openclaw team` CLI subcommands
    └── hooks/
        ├── bootstrap.ts       # agent:bootstrap — dynamic USER.md injection
        ├── prompt.ts          # before_prompt_build — team context injection
        ├── tool-gate.ts       # before_tool_call — role enforcement
        └── message.ts         # message_received — member resolution cache warm
```

### 4.2 Runtime data layout

```
~/.openclaw/
├── openclaw.json                         # User-managed gateway config
└── team/
    └── {teamId}/
        ├── members.db                    # SQLite: members, identities, invites
        ├── TEAM_MEMORY.md                # Long-term shared memory (always injected)
        └── memory/
            ├── YYYY-MM-DD.md             # Daily team log (on-demand)
            └── decisions.md              # Decision record (on-demand)

~/.openclaw/agents/
└── tm-{memberId}/                        # Per-member agent (auto-provisioned)
    ├── workspace/
    │   ├── AGENTS.md
    │   ├── SOUL.md
    │   ├── MEMORY.md                     # Personal long-term memory
    │   └── memory/
    │       └── YYYY-MM-DD.md             # Personal daily log
    ├── sessions/
    │   ├── sessions.json
    │   └── *.jsonl
    └── agent/
        └── auth-profiles.json
```

---

## 5. Data Model

### 5.1 Member

```typescript
interface Member {
  id: string;            // UUID, stable internal key
  teamId: string;        // Which team this member belongs to
  name: string;          // Display name
  role: "admin" | "member";
  agentId: string;       // OpenClaw agent id, e.g. "tm-abc123"
  createdAt: string;     // ISO timestamp
  notes?: string;        // Optional context hint for the agent about this person
}
```

### 5.2 ChannelIdentity

```typescript
interface ChannelIdentity {
  memberId: string;      // FK → Member.id
  channel: string;       // "telegram" | "discord" | "slack" | "whatsapp" | ...
  senderId: string;      // Channel-native sender ID, e.g. "tg:123456789"
}
```

**Rationale:** A single member may contact the bot from multiple channels. Binding all
sender IDs to one member record ensures consistent identity, memory, and permissions
regardless of channel.

### 5.3 Invite

```typescript
interface Invite {
  code: string;          // 6-char alphanumeric, expires in 24h
  teamId: string;
  role: "admin" | "member";
  createdBy: string;     // Member.id of the admin who created it
  expiresAt: string;     // ISO timestamp
  usedBy?: string;       // Member.id once redeemed
}
```

### 5.4 Team

```typescript
interface Team {
  id: string;
  name: string;
  createdAt: string;
}
```

---

## 6. Plugin Manifest

### 6.1 `package.json` (key fields)

```json
{
  "name": "@yourorg/openclaw-team-mode",
  "version": "0.1.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    }
  }
}
```

> Plugin manifest reference:  
> https://docs.openclaw.ai/plugins/manifest.md

### 6.2 `openclaw.plugin.json`

```json
{
  "id": "team-mode",
  "name": "Team Mode",
  "description": "Extends OpenClaw with multi-user team support: member registry, layered memory, and role-based permissions.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "teamId": { "type": "string", "description": "Active team identifier" },
      "teamName": { "type": "string", "description": "Human-readable team name" },
      "defaultRole": {
        "type": "string",
        "enum": ["admin", "member"],
        "default": "member"
      },
      "sharedMemoryMaxChars": {
        "type": "number",
        "default": 1000,
        "description": "Max chars of TEAM_MEMORY.md injected into every prompt"
      },
      "requireJoinBeforeChat": {
        "type": "boolean",
        "default": true,
        "description": "Block unregistered senders until they join with an invite code"
      }
    },
    "required": ["teamId", "teamName"]
  }
}
```

---

## 7. Hook Design

### 7.1 `agent:bootstrap` — Dynamic USER.md injection

**Purpose:** Replace the static `USER.md` workspace file with a member-specific version
before the bootstrap files are injected into the system prompt.

**Trigger:** Every agent run, before workspace files are sent to the model.

**SDK reference:**  
https://docs.openclaw.ai/automation/hooks.md (section: Agent Events → `agent:bootstrap`)  
https://docs.openclaw.ai/concepts/system-prompt.md (section: Workspace bootstrap injection)

**Logic:**

```
1. Extract sessionKey from event.context
2. Parse agentId from sessionKey ("agent:{agentId}:{rest}")
3. Look up member by agentId in member store
4. If found:
   a. Build USER.md content from member record (see §8.1)
   b. Find USER.md in bootstrapFiles array
   c. Replace content in-place (or push new entry if missing)
5. If not found: leave USER.md unchanged (fallback to static file)
```

**Key constraint:** `bootstrapFiles` is mutated in-place. The hook does **not** write
to disk — the replacement is ephemeral, per-run only.

> Bootstrap file injection reference:  
> https://docs.openclaw.ai/concepts/system-prompt.md  
> https://docs.openclaw.ai/concepts/agent-workspace.md

---

### 7.2 `before_prompt_build` — Team context injection

**Purpose:** Inject team-shared memory and role instructions into every agent run via
`prependContext`, without touching workspace files.

**Trigger:** After model is resolved, before the LLM API call.

**SDK reference:**  
https://docs.openclaw.ai/automation/hooks.md (section: Plugin Hook Events → `before_prompt_build`)

**Return shape:**

```typescript
{
  prependContext: string;  // XML block appended before the user message
}
```

**Injected block structure (see §8.2 for full template):**

```xml
<team_context>
  <team_name>...</team_name>
  <current_user role="admin|member">...</current_user>
  <team_shared_memory><!-- first N chars of TEAM_MEMORY.md --></team_shared_memory>
  <role_instructions><!-- capabilities and restrictions for this role --></role_instructions>
</team_context>
```

**Token budget:** `sharedMemoryMaxChars` config key controls truncation of the
`<team_shared_memory>` block. Default 1000 chars keeps overhead to ~250 tokens.

---

### 7.3 `before_tool_call` — Role-based permission gate

**Purpose:** Block admin-only tools when called by a member-role user.

**Trigger:** Before every tool call in the agent run.

**SDK reference:**  
https://docs.openclaw.ai/automation/hooks.md (section: Plugin Hook Events → `before_tool_call`)

**Return shape:**

```typescript
// Allow
{}

// Block
{ block: true, blockReason: "Only admins can use team_invite." }
```

**Admin-only tools:**

| Tool | Reason |
|------|--------|
| `team_invite` | Creates invite codes — admin only |
| `team_remove` | Removes members — admin only |
| `team_remember` | Writes to shared memory — admin only |
| `team_set_role` | Changes member roles — admin only |

**Logic:**

```
1. If tool name is not in ADMIN_ONLY_TOOLS → return {} (allow)
2. Resolve member from sessionKey
3. If member.role === "admin" → return {} (allow)
4. Return { block: true, blockReason: "..." }
```

---

### 7.4 `message_received` — Unregistered sender gate

**Purpose:** When `requireJoinBeforeChat` is true, respond with join instructions to
senders not in the member registry, and prevent the message from reaching the agent.

**Trigger:** Every inbound message.

**SDK reference:**  
https://docs.openclaw.ai/automation/hooks.md (section: Message flow hooks → `message_received`)

**Note:** This hook is parallel (fire-and-forget). To actually block routing, use
`inbound_claim` instead (sequential, returns `{ handled: boolean }`). If the plugin
needs to suppress agent processing, `inbound_claim` with `{ handled: true }` is the
correct mechanism.

---

## 8. Prompt Templates

### 8.1 Dynamic `USER.md` template

```markdown
# User Profile

**Name**: {member.name}
**Role**: {member.role}
**Team**: {team.name}
**Member ID**: {member.id}
{member.notes ? `\n**Context**: {member.notes}` : ""}

## Permissions
- Manage team members: {isAdmin ? "YES" : "NO"}
- Write to team memory: {isAdmin ? "YES" : "NO"}
- Modify team configuration: {isAdmin ? "YES" : "NO"}

## Available Team Commands
- `/team status` — Show team members and current context
- `/team memory` — Search team shared memory
{isAdmin ? "- `/team invite` — Generate an invite code\n- `/team remove <name>` — Remove a member" : ""}
```

**Design notes:**
- Keep this file concise. It is injected on every turn.
- The `## Permissions` section is the primary signal for the agent to enforce role
  behavior. The `before_tool_call` hook is the hard enforcement; this is soft guidance.
- `member.notes` is a free-text field admins can set to give the agent context about
  this person (e.g., "Senior backend engineer, prefers detailed technical answers").

---

### 8.2 `prependContext` XML template

```xml
<team_context>
<team_name>{team.name}</team_name>
<current_user role="{member.role}">{member.name}</current_user>
<team_shared_memory>
{teamMemorySummary}
</team_shared_memory>
<role_instructions>
{roleInstructions}
</role_instructions>
</team_context>
```

**`roleInstructions` for `admin`:**

```
You are serving a TEAM ADMIN. They have full permissions including:
- Inviting and removing team members
- Writing decisions and conventions to team shared memory via team_remember
- Viewing all member activity

When they use commands like /team invite or ask about member management, assist fully.
```

**`roleInstructions` for `member`:**

```
You are serving a TEAM MEMBER with standard access.
They cannot modify team membership or write to shared team memory.
If they request admin-only actions, explain politely that admin permission is required.
```

**`teamMemorySummary`:** First `sharedMemoryMaxChars` characters of `TEAM_MEMORY.md`.
If the file is missing or empty, this block is omitted entirely to avoid injecting
unhelpful filler text.

---

## 9. Tool Specifications

### 9.1 `team_remember`

Writes a new entry to the team's shared memory file.

```typescript
parameters: Type.Object({
  content: Type.String({
    description: "The information to remember at the team level"
  }),
  category: Type.Optional(Type.Union([
    Type.Literal("decision"),
    Type.Literal("convention"),
    Type.Literal("project"),
    Type.Literal("general"),
  ])),
})
```

**Behavior:**
1. Gate: admin only (also enforced by `before_tool_call`)
2. Append to `~/.openclaw/team/{teamId}/TEAM_MEMORY.md`:
   ```markdown
   ## {category} — {YYYY-MM-DD} (by {member.name})
   {content}
   ```
3. Return confirmation text.

**When to use:** The agent should call this when an admin says something like
"remember that we decided X" or "add to team memory: our convention is Y".

---

### 9.2 `team_status`

Returns a summary of the current team and member list. Available to all roles.

```typescript
parameters: Type.Object({})
```

**Returns:** Markdown-formatted team status:
```
**Team**: Acme Engineering
**Members** (3):
- Alice Zhang [admin]
- Bob Li [member] 
- Carol Wang [member]

**Team Memory**: Last updated 2026-03-31
```

---

### 9.3 `team_invite` *(admin only)*

Generates a one-time invite code.

```typescript
parameters: Type.Object({
  role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
  note: Type.Optional(Type.String({
    description: "Optional context hint about the invitee"
  })),
})
```

**Behavior:**
1. Generate 6-char alphanumeric code
2. Store in SQLite with 24h expiry
3. Return: `Invite code: **XK7P2M** (expires in 24h). New member should send: /team join XK7P2M`

---

### 9.4 `team_join` *(slash command, not a tool)*

Registered as a slash command that bypasses the LLM to handle member onboarding
without consuming tokens.

**Trigger:** User sends `/team join <code>` in any channel.

**Behavior:**
1. Validate invite code (exists, not expired, not used)
2. Check if this sender ID is already registered — if yes, add as additional identity
3. If new: create Member record + ChannelIdentity, provision agent config
4. Mark invite as used
5. Reply: `Welcome to {teamName}, {name}! You've joined as a {role}.`

**Agent provisioning on join (see §10):**
- This is the only moment a new agent entry needs to be added to OpenClaw config.
- The plugin writes a config fragment; user must restart gateway (or plugin triggers
  `config.apply` via the gateway tool if available).

> Slash command registration reference:  
> https://docs.openclaw.ai/tools/slash-commands.md

---

## 10. Agent Provisioning

When a new member joins, the plugin needs to create a per-member OpenClaw agent.
This involves writing to `openclaw.json`, which requires careful handling.

### 10.1 What needs to be created

1. **Agent entry** in `agents.list`:
   ```json5
   {
     id: "tm-{memberId}",
     workspace: "~/.openclaw/agents/tm-{memberId}/workspace",
     agentDir: "~/.openclaw/agents/tm-{memberId}/agent"
   }
   ```

2. **Binding entry** in `bindings`:
   ```json5
   {
     agentId: "tm-{memberId}",
     match: {
       channel: "{channelId}",
       peer: { kind: "direct", id: "{senderId}" }
     }
   }
   ```

3. **Workspace directory** with bootstrap files:
   ```
   ~/.openclaw/agents/tm-{memberId}/workspace/
     AGENTS.md   (team-standard template)
     SOUL.md     (team-standard template)
   ```

### 10.2 Config write strategy

**Option A (Recommended for Phase 1):** Write a partial config file that the user
merges manually, and display instructions in the CLI.

```
openclaw team join <code>
→ "Member registered. Run: openclaw team apply-config && openclaw gateway restart"
```

**Option B (Phase 2):** Use `api.runtime` or the gateway `config.apply` mechanism to
patch config programmatically, then trigger a gateway reload.

> Multi-agent routing reference:  
> https://docs.openclaw.ai/concepts/multi-agent.md  
> Configuration reference:  
> https://docs.openclaw.ai/gateway/configuration.md

### 10.3 Session isolation requirement

Each member **must** have `session.dmScope` set to at least `per-channel-peer` at the
gateway level to prevent cross-member context leakage when all DMs go to one agent.
However, with the per-member agent approach (one `agentId` per member), the binding
itself ensures isolation — DMs from Alice only reach Alice's agent.

> Session isolation reference:  
> https://docs.openclaw.ai/concepts/session.md

---

## 11. Memory System

### 11.1 Layered memory model

```
Layer 1: Personal Memory (fully isolated per member)
  Path:  ~/.openclaw/agents/tm-{memberId}/workspace/MEMORY.md
         ~/.openclaw/agents/tm-{memberId}/workspace/memory/YYYY-MM-DD.md
  Read:  Injected automatically by OpenClaw (MEMORY.md every session)
         Daily files via memory_search / memory_get tools
  Write: Agent writes naturally during conversation (OpenClaw native)
  Scope: Visible only to that member's agent

Layer 2: Team Shared Memory (controlled write, summarized read)
  Path:  ~/.openclaw/team/{teamId}/TEAM_MEMORY.md
         ~/.openclaw/team/{teamId}/memory/YYYY-MM-DD.md
         ~/.openclaw/team/{teamId}/memory/decisions.md
  Read:  Summary injected via before_prompt_build (always)
         Full content via team_memory_search tool (on demand)
  Write: Explicit only via team_remember tool (admin only)
  Scope: Visible to all team members
```

### 11.2 Read paths

**Personal memory read:**  
OpenClaw handles this natively. `MEMORY.md` is injected every session. Daily files are
retrieved on-demand by the agent using `memory_search` or `memory_get`.

> Memory reference:  
> https://docs.openclaw.ai/concepts/memory.md  
> https://docs.openclaw.ai/concepts/memory-builtin.md

**Team shared memory read:**  
Two paths:

1. **Passive (every turn):** First `sharedMemoryMaxChars` chars of `TEAM_MEMORY.md`
   are injected by `before_prompt_build` into `prependContext`. This ensures the agent
   always has team context without any tool call.

2. **Active (on demand):** A `team_memory_search` tool (Phase 2) allows semantic search
   over all team memory files. Useful for deep retrieval of past decisions.

### 11.3 Write paths

**Personal memory write:**  
Standard OpenClaw behavior. The agent writes to `MEMORY.md` or `memory/YYYY-MM-DD.md`
in its own workspace when instructed or during the pre-compaction flush.

> Memory flush reference:  
> https://docs.openclaw.ai/concepts/memory.md (section: Automatic memory flush)

**Team shared memory write:**  
Exclusively through the `team_remember` tool. This is intentional — shared memory
should be deliberate, not accumulated automatically from individual conversations.

```
Admin says: "Add to team memory: we're adopting pnpm as our package manager"
Agent calls: team_remember({ content: "...", category: "convention" })
Plugin appends to: ~/.openclaw/team/{teamId}/TEAM_MEMORY.md
```

**Team daily log write (Phase 2):**  
An `after_compaction` hook can append a per-session summary to the team's daily log file
when the session involves a significant team-relevant discussion. Requires agent
judgment (via LLM sub-call) to decide what is team-relevant. Deferred to Phase 2.

---

## 12. CLI Commands

Registered via `api.registerCli(...)` as the `team` subcommand group.

> CLI registration reference:  
> https://docs.openclaw.ai/plugins/sdk-overview.md (section: CLI registration metadata)

```
openclaw team init
  Create a new team on this gateway instance.
  Prompts: team name, your name (first admin), initial channel identity.
  Writes plugin config and provisions first agent.

openclaw team status
  Display team name, member count, and team memory summary.

openclaw team members [--json]
  List all team members with their roles and registered channel identities.

openclaw team invite [--role member|admin] [--note "..."]
  Generate a one-time invite code (24h expiry).
  Prints the code and the /team join instruction to send to the invitee.

openclaw team remove <member-name-or-id>
  Remove a member and their agent/workspace (with confirmation prompt).
  Does NOT delete session transcripts by default.

openclaw team set-role <member-name-or-id> admin|member
  Change a member's role.

openclaw team identity add <member-name-or-id> <channel> <sender-id>
  Manually bind an additional channel identity to an existing member.

openclaw team memory show [--lines N]
  Display the current team shared memory file.

openclaw team memory clear [--backup]
  Clear team shared memory (with confirmation and optional backup).

openclaw team apply-config
  Write the pending agent/binding entries to openclaw.json.
  Safe: reads existing config, merges, writes back.
  Prints a diff before applying.
```

---

## 13. HTTP Admin Routes

Registered via `api.registerHttpRoute(...)`. All routes require gateway auth.

> HTTP route registration reference:  
> https://docs.openclaw.ai/plugins/architecture.md (section: Gateway HTTP routes)

```
GET  /team/status
     Returns team summary as JSON.

GET  /team/members
     Returns full member list as JSON.

POST /team/members
     Body: { inviteCode, name, channel, senderId }
     Programmatic member join (same logic as /team join slash command).

POST /team/memory
     Body: { content, category, authorMemberId }
     Admin-authenticated write to team shared memory.
     Requires gateway auth + admin role check.
```

---

## 14. Configuration Schema

Plugin config lives under `plugins.entries["team-mode"].config` in `openclaw.json`.

```json5
{
  plugins: {
    entries: {
      "team-mode": {
        enabled: true,
        config: {
          teamId: "acme-eng",          // Required. Stable identifier, used in file paths.
          teamName: "Acme Engineering", // Required. Displayed to users and injected in prompts.
          defaultRole: "member",        // Role assigned when no invite specifies a role.
          sharedMemoryMaxChars: 1000,   // Max chars of TEAM_MEMORY.md in each prompt.
          requireJoinBeforeChat: true,  // Block unregistered senders until they join.
        },
      },
    },
  },
}
```

The plugin also requires these gateway-level settings to be configured by the user
(the plugin will warn via `openclaw doctor` if they are missing):

```json5
{
  session: {
    dmScope: "per-channel-peer",  // Essential: prevents cross-user context leakage
  },
}
```

---

## 15. Phased Delivery Plan

### Phase 1 — Core MVP

**Goal:** A team can install the plugin, register members, and get role-aware
isolated conversations with shared team context in prompts.

| # | Feature | Key files |
|---|---------|-----------|
| 1 | Plugin scaffold (manifest, entry points) | `package.json`, `openclaw.plugin.json`, `index.ts`, `setup-entry.ts` |
| 2 | Member store (SQLite CRUD) | `src/member-store.ts` |
| 3 | `agent:bootstrap` hook — dynamic USER.md | `src/hooks/bootstrap.ts` |
| 4 | `before_prompt_build` hook — team context | `src/hooks/prompt.ts` + `src/prompt-builder.ts` |
| 5 | `before_tool_call` hook — permission gate | `src/hooks/tool-gate.ts` + `src/permission.ts` |
| 6 | `team_remember` tool | `src/tools/team-remember.ts` |
| 7 | `team_status` tool | `src/tools/team-status.ts` |
| 8 | `team init` + `team members` CLI | `src/cli.ts` |
| 9 | `team invite` + `/team join` slash command | `src/cli.ts` + join handler |
| 10 | `team apply-config` CLI (writes agents + bindings) | `src/agent-provisioner.ts` |

### Phase 2 — Enhanced Memory & Management

| Feature | Notes |
|---------|-------|
| `team_memory_search` tool | Semantic search over team memory files (requires embedding provider) |
| Auto team daily log | `after_compaction` hook extracts team-relevant summaries |
| HTTP admin routes | REST API for web-based team management |
| `team remove` + `team set-role` CLI | Member lifecycle management |
| Gateway config hot-reload on member join | Eliminates manual `apply-config` + restart step |
| `inbound_claim` hook for unregistered senders | Clean blocking with helpful join instructions |

---

## 16. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Config write conflicts (two processes writing `openclaw.json`) | `apply-config` CLI does read-merge-write with file lock; never patch directly from hooks |
| Token budget blowout from team memory injection | `sharedMemoryMaxChars` config cap; default 1000 chars (~250 tokens); monitor via `/context detail` |
| Cross-member data access via absolute file paths | OpenClaw workspace is default cwd, not hard sandbox; document this limitation; recommend `sandbox.mode: "all"` for sensitive teams |
| Member store corruption | SQLite with WAL mode; all writes in transactions; CLI includes `team backup` |
| `agent:bootstrap` mutating wrong session | Always verify `agentId` prefix (`tm-`) before mutating `bootstrapFiles`; log unexpected sessions |
| Invite code brute force | 6-char code = 36^6 ~= 2B combinations; rate-limit join attempts per sender via a cooldown table in SQLite |

---

## 17. Reference Documentation Index

All links point to the official OpenClaw documentation at `docs.openclaw.ai`.

### Plugin Development
- **Building Plugins (Getting Started):** https://docs.openclaw.ai/plugins/building-plugins.md
- **Plugin SDK Overview (Registration API):** https://docs.openclaw.ai/plugins/sdk-overview.md
- **Plugin Entry Points:** https://docs.openclaw.ai/plugins/sdk-entrypoints.md
- **Plugin Manifest Format:** https://docs.openclaw.ai/plugins/manifest.md
- **Plugin Architecture (Internals):** https://docs.openclaw.ai/plugins/architecture.md
- **Plugin Testing:** https://docs.openclaw.ai/plugins/sdk-testing.md
- **Plugin Runtime Helpers:** https://docs.openclaw.ai/plugins/sdk-runtime.md
- **Plugin Setup & Config:** https://docs.openclaw.ai/plugins/sdk-setup.md

### Hooks
- **Hook System (Internal Hooks):** https://docs.openclaw.ai/automation/hooks.md
- **`agent:bootstrap` event:** https://docs.openclaw.ai/automation/hooks.md#agent-events
- **`before_prompt_build` plugin hook:** https://docs.openclaw.ai/automation/hooks.md#model-and-prompt-hooks
- **`before_tool_call` plugin hook:** https://docs.openclaw.ai/automation/hooks.md#before_tool_call
- **`inbound_claim` plugin hook:** https://docs.openclaw.ai/automation/hooks.md#message-flow-hooks
- **`message_received` plugin hook:** https://docs.openclaw.ai/automation/hooks.md#message-flow-hooks

### System Prompt & Context
- **System Prompt Structure:** https://docs.openclaw.ai/concepts/system-prompt.md
- **Context Engine:** https://docs.openclaw.ai/concepts/context-engine.md
- **Context Overview:** https://docs.openclaw.ai/concepts/context.md
- **Agent Workspace Files:** https://docs.openclaw.ai/concepts/agent-workspace.md

### Memory
- **Memory Overview:** https://docs.openclaw.ai/concepts/memory.md
- **Builtin Memory Engine:** https://docs.openclaw.ai/concepts/memory-builtin.md
- **Memory Search:** https://docs.openclaw.ai/concepts/memory-search.md
- **Memory Configuration Reference:** https://docs.openclaw.ai/reference/memory-config.md

### Multi-Agent & Sessions
- **Multi-Agent Routing:** https://docs.openclaw.ai/concepts/multi-agent.md
- **Session Management:** https://docs.openclaw.ai/concepts/session.md
- **Channel Routing:** https://docs.openclaw.ai/channels/channel-routing.md
- **Session Tools:** https://docs.openclaw.ai/concepts/session-tool.md

### Security & Configuration
- **Security Model:** https://docs.openclaw.ai/gateway/security/index.md
- **Gateway Configuration:** https://docs.openclaw.ai/gateway/configuration.md
- **Configuration Reference:** https://docs.openclaw.ai/gateway/configuration-reference.md
- **Sandboxing:** https://docs.openclaw.ai/gateway/sandboxing.md

### Tools & Commands
- **Slash Commands:** https://docs.openclaw.ai/tools/slash-commands.md
- **Tools Overview:** https://docs.openclaw.ai/tools/index.md
- **Exec Tool:** https://docs.openclaw.ai/tools/exec.md

### CLI
- **CLI Reference:** https://docs.openclaw.ai/cli/index.md
- **Plugins CLI:** https://docs.openclaw.ai/cli/plugins.md

---

## 18. Open Questions

These items need a decision before or during Phase 1 development:

1. **Config patching mechanism:** Should `team apply-config` use a direct JSON merge
   written to disk, or call OpenClaw's `config.apply` gateway method? The gateway
   method is cleaner but requires the gateway to be running. Direct file write works
   offline but risks format issues.

2. **First admin bootstrap:** How does the very first admin register? Options:
   (a) `openclaw team init` CLI creates the first member record automatically using
   the caller's OS identity, or (b) an explicit `--admin-channel` and `--admin-sender-id`
   flag is required. Option (a) is simpler UX.

3. **Workspace seeding on member join:** Should the plugin copy a template workspace
   (`AGENTS.md`, `SOUL.md`) from a team-standard template, or generate minimal stubs?
   Template approach allows teams to customize the agent persona per-install.

4. **Gateway restart on member join:** Member join requires new `agents.list` and
   `bindings` entries, which only take effect after a gateway restart. Is this
   acceptable UX for Phase 1, or must we find a hot-reload path?

5. **Team memory format:** Should `TEAM_MEMORY.md` be free-form Markdown (easy to read
   and edit by hand) or a structured format (e.g., TOML/JSON) that is easier to parse
   for search? Recommendation: Markdown with section headers by category.
