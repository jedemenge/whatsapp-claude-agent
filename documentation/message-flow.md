# Message Flow

## Startup Flow

```
main()
  ├─ parseArgs() → validate config
  ├─ createLogger()
  ├─ SDKBackend(config) → setSessionCallback()
  ├─ WhatsAppClient(config)
  ├─ ConversationManager(backend, config)
  ├─ Wire up event handlers
  └─ whatsapp.connect()
       │
       ▼
WhatsApp 'ready' event
  ├─ If --join-whatsapp-group: joinGroup(inviteCode)
  └─ If !hasAnnouncedStartup && !config.suppressStartupAnnouncement:
     sendStartupAnnouncement()
       ├─ Group mode: send to group JID
       └─ Private mode:
            ├─ Route each whitelist entry through whitelistEntryToSendableJid()
            ├─ LID-only entries (e.g. "xxx@lid") are skipped with an info log
            ├─ Deduplicate destinations (phone+lid for the same person → 1 send)
            └─ Send the announcement to each unique JID
```

Subsequent `'ready'` events (triggered after every reconnect) log a
"reconnected" message and do NOT re-send the announcement. The one-shot
gate `hasAnnouncedStartup` in `index.ts` enforces this. The opt-in
`suppressStartupAnnouncement` config additionally skips the first one.

Startup announcement (private mode):

```
Now online!

🤖 Name: *{name}*
🖥️ Host: {host}
📁 Directory: {directory}
🔐 Mode: {mode}
🧠 Model: {model}
💬 Chat: Private

Type */help* for available commands.
```

Startup announcement (group mode):

```
Now online!

🤖 Name: *{name}*
🖥️ Host: {host}
📁 Directory: {directory}
🔐 Mode: {mode}
🧠 Model: {model}
👥 Chat: Group

*Target me with:*
• @{name} <message>
• @ai <message>
• @agent <message>
• @{bot-number} <message>   (when sock.user resolves; uses WhatsApp's @-picker)
• /ask <message>

Check if online: */agent*
```

## Incoming Message Pipeline

```
Baileys WebSocket
       │
       ▼
WhatsAppClient.handleMessage()
  ├─ parseMessage() → IncomingMessage
  │     (includes participant, isGroupMessage, Baileys v7 LID/PN
  │      alternates: fromAlt, participantAlt, addressingMode, AND
  │      mentions[] from extendedTextMessage.contextInfo.mentionedJid)
  ├─ Filter: isFromMe? → skip
  ├─ Group mode filtering:
  │    ├─ If not group message → skip
  │    ├─ If wrong group JID → skip
  │    ├─ If message starts with [🤖 → skip (other agent)
  │    └─ If !allowAllGroupParticipants && neither participant nor
  │       participantAlt is in whitelist → skip
  ├─ Private mode filtering:
  │    ├─ If group message → skip
  │    └─ If neither from nor fromAlt is in whitelist → skip
  │       (block warn includes "(alt: ...)" when an alternate exists;
  │        an actionable @lid hint fires when no alternate is reported)
  ├─ Filter: withinThreshold? → skip if too old
  └─ emit('event', { type: 'message', message })
       │
       ▼
index.ts event handler
  └─ conversation.handleMessage(message, sendResponse, sendTyping)
       │
       ▼
ConversationManager.handleMessage()
  ├─ Group mode targeting check:
  │    ├─ parseAgentTargeting(text, agentName, botIdentity, mentions)
  │    ├─ If not targeted (@name, @ai, @agent, @<bot-number>, /ask) → skip
  │    │   (@<bot-number> resolves via mentionedJid against the bot's
  │    │    own PN/LID, mirroring the whitelist dual-identity pattern)
  │    └─ Strip targeting prefix from message
  ├─ Check pending permissions → tryResolveFromMessage()
  ├─ Check isCommand() → handleCommand()
  └─ else → processWithClaude()
```

## Command Flow

```
handleCommand()
  ├─ parseCommand() → { command, args }
  └─ switch(command)
       ├─ 'clear' → history.clear()
       ├─ 'mode' → show current
       ├─ 'plan'/'default'/... → setMode()
       ├─ 'prompt' → handleSystemPromptCommand()
       ├─ 'model' → handleModelCommand()
       ├─ 'config' → handleConfigCommand()
       └─ ... etc
```

## Claude Query Flow

```
processWithClaude()
  ├─ sendTyping()
  ├─ history.addUserMessage()
  ├─ backend.query(text, history)
  │     │
  │     ▼
  │   SDKClaudeBackend.query()
  │     ├─ Build options (model, cwd, mode, prompts, session)
  │     ├─ claudeClient.processQuery()
  │     │     └─ Spawns Claude Code subprocess
  │     ├─ Handle permission callbacks
  │     ├─ Capture session ID from result
  │     └─ Return { text, toolsUsed, error }
  │
  ├─ history.addAssistantMessage()
  └─ sendResponse(text)
```

## Permission Flow

```
Claude requests tool use
       │
       ▼
permissionCallback(toolName, description, input)
  └─ PermissionManager.requestPermission()
       ├─ Create PermissionRequest with Promise
       ├─ Emit 'permission-request' event
       └─ Return Promise (blocks SDK)
              │
              ▼
       WhatsApp shows prompt to user
              │
              ▼
       User responds:
         Private mode: Y/YES/ALLOW or N/NO/DENY
         Group mode: @name Y/N, @ai Y/N, @agent Y/N
              │
              ▼
       handleMessage()
         ├─ Group mode: parseAgentTargeting() first
         └─ tryResolveFromMessage() on cleaned message
              │
              ▼
       Resolves Promise → SDK continues
```

Permission request message (private mode):

```
🔐 *Permission Request*

Claude wants to use *{toolName}*:

\`\`\`
{description}
\`\`\`

Reply *Y* to allow or *N* to deny.
(Auto-denies in 5 minutes)
```

Permission request message (group mode):

```
🔐 *Permission Request*

Claude wants to use *{toolName}*:

\`\`\`
{description}
\`\`\`

Reply with *@{name} Y* to allow or *@{name} N* to deny.
(Also works: @ai Y/N, @agent Y/N)
(Auto-denies in 5 minutes)
```

## Response Flow

```
sendResponse(text)
       │
       ▼
index.ts sendResponse callback (try/catch boundary)
  └─ whatsapp.sendMessage(jid, text)
       │
       ▼
WhatsAppClient.sendMessage()
  ├─ await waitUntilReady(sendReadyTimeoutMs)   ← bridges reconnect window
  ├─ formatMessageWithAgentName() → "[🤖 Name@host folder/]\ntext"  (skipped when hideAgentPrefix=true)
  ├─ chunkMessage() → splits if > 4000 chars
  └─ sock.sendMessage() for each chunk
```

### Presence ack (ackOnTarget)

When `ackOnTarget` is enabled, `ConversationManager.handleMessage()` fires
`whatsapp.sendReaction(jid, msg.key, ackOnTargetEmoji)` immediately after the
targeting check passes — _before_ any history append, permission resolution,
command dispatch, or Claude SDK call. The reaction is fire-and-forget; if the
socket is not ready it is dropped silently rather than parked on
`waitUntilReady` (a delayed presence signal is worse than none).

The intent is operator-visible: when the host is suspended (macOS App Nap,
closed lid) the reaction never lands, so the missing emoji on a recent message
is the cue that the agent is asleep. When the host wakes and the SDK call
resumes, the eventual reply still arrives — but the absence of the ack during
the freeze is the diagnostic.

### Reconnect-safe send

`WhatsAppClient.sendMessage()` used to throw `Error("WhatsApp client not ready")`
synchronously whenever the socket was mid-reconnect. Since a 408 disconnect
followed by a fast reconnect is routine on Bun, this race would crash the
process whenever a message arrived during the ~1-2 s window.

The pipeline now:

1. `sendMessage()` awaits `waitUntilReady(config.sendReadyTimeoutMs)` which
   parks the caller on an internal list of `readyWaiters` and resolves when
   `connection === 'open'` fires. Default wait: 15 s.
2. If the wait times out, `WhatsAppNotReadyError` is thrown.
3. The outer `sendResponse` closure in `index.ts` wraps the call in try/catch.
   A failed delivery is logged (full text truncated to 200 chars) and the
   request path continues — nothing escapes to the top of the event loop.
4. `ConversationManager.processWithClaude()` tracks `primarySendAttempted`
   so its catch branch never re-invokes `sendResponse` on the same dead
   socket (the double-throw that previously brought the process down).

### Verified reconnect behaviour

Field evidence from a ~2.5 h soak on `fix/reconnect-race-and-announcement-flood`.
Log lines are redacted but otherwise verbatim.

**1. Reconnects do not re-announce.** First `ready` triggers the group
message; every subsequent reconnect logs `reconnected` and emits nothing into
the group.

    16:02:11 INFO  startup announcement sent to <group-jid>
    16:47:33 WARN  connection closed statusCode=408
    16:47:34 INFO  reconnecting…
    16:47:36 INFO  reconnected (no announcement)

**2. Message arriving during a reconnect window is answered normally.** In
the soak run a user message landed at 18:30:38 while the socket was
mid-reconnect after an 18:30:37 408. `waitUntilReady` parked the send; reply
went out once the socket came back, no crash.

    18:30:37 WARN  connection closed statusCode=408
    18:30:38 INFO  message received from=<user-msisdn> text="/ask …"
    18:30:38 DEBUG sendMessage awaiting ready (readyWaiters=1)
    18:30:39 INFO  reconnected
    18:30:39 DEBUG sendMessage flushed after ready

**3. 408 cadence is reduced, not eliminated.** Observed intervals between
disconnects during the soak: ~7 min, ~22 min, ~18 min, ~30 min, ~14 min.
Previously ~20–25 min steady; now variable and often longer, but still
present — which is why Fix 1 (survive the race) is the load-bearing change
and Fix 2 (tighter keepalive) is secondary mitigation. `LAUNCHD_SETUP.md` is
no longer required to keep the agent alive through these hiccups.

**4. Permission auto-deny still fires across reconnects.** A `/permission`
prompt that timed out spanning a reconnect still auto-denied cleanly:

    19:14:02 INFO  permission requested tool=Bash
    19:14:18 WARN  connection closed statusCode=408
    19:14:20 INFO  reconnected
    19:19:02 INFO  permission auto-denied after 5m timeout

## Session Management

- Session ID captured after first successful query
- Stored in backend, retrievable via `/session`
- Changed by: `/session <id>`, `--resume`
- Cleared by: `/session clear`, `/cd`, `/model`, `/prompt`
- Fork: `/fork` sets flag, next query creates branch

## History Management

- `ConversationHistory` stores last 50 entries
- Each entry: `{ role, content, timestamp }`
- Passed to Claude for context
- Cleared on: `/clear`, session changes, mode changes
