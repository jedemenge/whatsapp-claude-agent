# Configuration

## Required Options

**`whitelist`** — MANDATORY. App exits if not provided via CLI (`-w`) or config file. Must contain at least one entry: a phone number (preferred, e.g. `+31683999861`) or a WhatsApp privacy ID (`xxx` or `xxx@lid`). See "LID/PN dual identity" below.

## CLI Config Management

Manage config without running agent via `config` subcommand:

```bash
# Initialize new config
whatsapp-claude-agent config init                           # basic config
whatsapp-claude-agent config init -w "+1234567890"          # with whitelist
whatsapp-claude-agent config init -w "+111,+222"            # multiple numbers
whatsapp-claude-agent config init --model opus              # with specific model
whatsapp-claude-agent config init -w "+123" -v --model opus # combine options
whatsapp-claude-agent config init --force                   # overwrite existing

# View config
whatsapp-claude-agent config show              # human-readable (alias: list)
whatsapp-claude-agent config show --json       # JSON output
whatsapp-claude-agent config export            # JSON to stdout

# Get/set individual values
whatsapp-claude-agent config get model
whatsapp-claude-agent config set model opus
whatsapp-claude-agent config set whitelist "+111,+222"
whatsapp-claude-agent config set verbose true
whatsapp-claude-agent config unset maxTurns   # alias: delete

# Import config
whatsapp-claude-agent config import '{"model":"opus"}'         # JSON string
whatsapp-claude-agent config import config.backup.json         # from file
whatsapp-claude-agent config import config.backup.json --merge # merge with existing

# Specify config location
whatsapp-claude-agent config -d /path/to/project show
whatsapp-claude-agent config -c /custom/path.json set model haiku
```

Valid keys for set/get: whitelist, directory, mode, sessionPath, model, maxTurns, processMissed, missedThresholdMins, verbose, agentName, systemPrompt, systemPromptAppend, settingSources, keepAliveIntervalMs, sendReadyTimeoutMs, suppressStartupAnnouncement, hideAgentPrefix, ackOnTarget, ackOnTargetEmoji, botNumber

### LID/PN dual identity

Baileys v7 may deliver messages in **LID addressing mode**, where the sender's primary `key.remoteJid` (or `key.participant` for groups) is a `xxx@lid` privacy ID and the phone-number JID sits on `key.remoteJidAlt` / `key.participantAlt`. The whitelist matcher considers **both** the primary and the alternate, so a phone-only whitelist normally Just Works for both DMs and group chats — no LID configuration required.

Add `xxx@lid` entries only as a fallback for senders whose messages do not carry a phone alternate (some group participants). Mixing forms is supported (e.g. `-w "+31683999861,170025004613669@lid"`); duplicates in the destination set for the startup announcement are collapsed automatically.

LID-only whitelist entries (no PN form alongside) are **accepted for inbound matching** but **skipped for the startup announcement** with an info-level log — sending to a bare `@lid` produces malformed JIDs and can echo back through the alternate identity, triggering an announcement loop. Add your phone number alongside the LID if you want to be greeted on startup.

## Sources (Priority Order)

1. **CLI arguments** (highest) — override everything
2. **Config file** — `{directory}/.whatsapp-claude-agent.json` (working directory)
3. **Built-in defaults** (lowest)

## Config File Location

Config is loaded from the working directory: `{directory}/.whatsapp-claude-agent.json`

Specify custom path: `-c, --config <path>`

## Schema

Defined in `src/types.ts` via Zod:

```typescript
// Agent identity with separate components
AgentIdentitySchema = z.object({
    name: z.string(), // The agent's name (superhero name or custom)
    host: z.string(), // Hostname where agent runs
    folder: z.string() // Working directory basename
})

ConfigSchema = z.object({
    directory: z.string().default(process.cwd()),
    mode: PermissionModeSchema.default('default'),
    whitelist: z.array(z.string()).min(1),
    sessionPath: z.string().default('~/.whatsapp-claude-agent/session'),
    model: z.string().default('claude-sonnet-4-20250514'),
    maxTurns: z.number().optional(),
    processMissed: z.boolean().default(false),
    missedThresholdMins: z.number().default(60),
    verbose: z.boolean().default(false),
    systemPrompt: z.string().optional(),
    systemPromptAppend: z.string().optional(),
    settingSources: z.array(SettingSourceSchema).optional(),
    resumeSessionId: z.string().optional(),
    forkSession: z.boolean().default(false),
    agentName: z.string().optional(), // Custom name (overrides generated)
    agentIdentity: AgentIdentitySchema, // Full identity with components
    joinWhatsAppGroup: z.string().optional(),
    allowAllGroupParticipants: z.boolean().default(false),
    keepAliveIntervalMs: z.number().int().positive().default(15000),
    sendReadyTimeoutMs: z.number().int().nonnegative().default(15000),
    suppressStartupAnnouncement: z.boolean().default(false),
    hideAgentPrefix: z.boolean().default(false),
    ackOnTarget: z.boolean().default(false),
    ackOnTargetEmoji: z.string().default('👀'),
    botNumber: z.string().optional() // Pin the bot's own phone for self-mention detection
})
```

### Reconnect hardening options

- **`keepAliveIntervalMs`** (default `15000`) — interval for the Baileys application-layer keepalive ping (IQ `ping`). Baileys' own default is 30000; the lower value reduces 408 disconnect frequency observed on Bun's `ws` shim.
- **`sendReadyTimeoutMs`** (default `15000`) — how long `WhatsAppClient.sendMessage()` waits for the socket to come back during a reconnect window before it gives up. Set to `0` to revert to the legacy "throw immediately" behaviour. When a send times out the outer boundary in `index.ts` logs the undelivered text and continues — the process does NOT crash.
- **`suppressStartupAnnouncement`** (default `false`) — skips the "Now online!" message on startup. Reconnects never emit the announcement regardless of this flag (fix for the spam seen under process supervisors).

### Presence and identity options

- **`hideAgentPrefix`** (default `false`) — suppresses the `[🤖 Name@host folder/]\n` line prepended to every outgoing message. Useful when the agent shares a chat with humans and the prefix is just noise. Caveat: other agents in the same group rely on the `[🤖` prefix to detect bot traffic and ignore each other (`src/whatsapp/client.ts` self-loop guard). With this flag set, two agents in the same group could reply to each other's messages. Our own self-echo guard via `sentMessageIds` is unaffected.
- **`ackOnTarget`** (default `false`) — sends a WhatsApp emoji reaction to every message that targets this agent (group: any of `@Name`, `@ai`, `@agent`, `/ask`; private: every whitelisted message). The reaction fires before any blocking work so a stalled host (suspended Bun, hung SDK call) is visible in the chat as a _missing_ reaction.
- **`ackOnTargetEmoji`** (default `👀`) — emoji used by `ackOnTarget`. Any single emoji or short string Baileys accepts as a reaction text.
- **`botNumber`** (optional) — pin the bot's own phone number (e.g. `+31123456789`) used for self-mention detection in groups. When omitted the agent auto-derives both PN and LID forms from `sock.user` after the first `connection: 'open'` event. Only set this if Baileys reports the wrong account (multi-device edge cases) — the auto-derived value is normally correct. The matching follows the same dual PN/LID approach as the whitelist (commit `76b066c`): mentions arriving in either addressing mode are recognised.

## CLI to Config Mapping

| CLI                               | Config Property               |
| --------------------------------- | ----------------------------- |
| `-d, --directory`                 | `directory`                   |
| `-m, --mode`                      | `mode`                        |
| `-w, --whitelist`                 | `whitelist`                   |
| `-s, --session`                   | `sessionPath`                 |
| `--model`                         | `model`                       |
| `--max-turns`                     | `maxTurns`                    |
| `--process-missed`                | `processMissed`               |
| `--missed-threshold`              | `missedThresholdMins`         |
| `-v, --verbose`                   | `verbose`                     |
| `--system-prompt`                 | `systemPrompt`                |
| `--system-prompt-append`          | `systemPromptAppend`          |
| `--load-claude-md`                | `settingSources`              |
| `--resume`                        | `resumeSessionId`             |
| `--fork`                          | `forkSession`                 |
| `--agent-name`                    | `agentName`                   |
| `--join-whatsapp-group`           | `joinWhatsAppGroup`           |
| `--allow-all-group-participants`  | `allowAllGroupParticipants`   |
| `--keep-alive-interval`           | `keepAliveIntervalMs`         |
| `--send-ready-timeout`            | `sendReadyTimeoutMs`          |
| `--suppress-startup-announcement` | `suppressStartupAnnouncement` |
| `--hide-agent-prefix`             | `hideAgentPrefix`             |
| `--ack-on-target`                 | `ackOnTarget`                 |
| `--ack-on-target-emoji`           | `ackOnTargetEmoji`            |
| `--bot-number`                    | `botNumber`                   |

## Save/Load Functions

```typescript
// src/cli/config.ts

loadConfigFile(configPath?: string, directory?: string): Partial<Config>
// Loads from configPath or {directory}/.whatsapp-claude-agent.json

saveConfigFile(config: Config, configPath?: string): string
// Saves to path or {config.directory}/.whatsapp-claude-agent.json
// Returns saved path

getLocalConfigPath(directory?: string): string
// {directory}/.whatsapp-claude-agent.json

generateConfigTemplate(options?: ConfigInitOptions): string
// Returns JSON string for template (accepts whitelist, model, mode, verbose, etc.)
```

## Saveable vs Runtime Properties

Only persistent properties saved to file (defined in `SAVEABLE_KEYS` in `src/cli/config.ts`):

- whitelist, directory, mode, sessionPath, model, maxTurns
- processMissed, missedThresholdMins, verbose, agentName
- systemPrompt, systemPromptAppend, settingSources
- keepAliveIntervalMs, sendReadyTimeoutMs, suppressStartupAnnouncement
- hideAgentPrefix, ackOnTarget, ackOnTargetEmoji, botNumber

Runtime-only (not saved):

- resumeSessionId, forkSession, joinWhatsAppGroup, allowAllGroupParticipants

## Adding New Config Options

1. Add to `ConfigSchema` in `src/types.ts`
2. Add CLI option in `src/cli/commands.ts`
3. Add merge logic in `parseConfig()` in `src/cli/config.ts`
4. If saveable, add to `SAVEABLE_KEYS` array
5. Update README config table
