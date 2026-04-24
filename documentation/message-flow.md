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
  └─ sendStartupAnnouncement()
       ├─ Group mode: send to group JID
       └─ Private mode:
            ├─ Route each whitelist entry through whitelistEntryToSendableJid()
            ├─ LID-only entries (e.g. "xxx@lid") are skipped with an info log
            ├─ Deduplicate destinations (phone+lid for the same person → 1 send)
            └─ Send the announcement to each unique JID
```

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
  │     (includes participant, isGroupMessage, AND Baileys v7 LID/PN
  │      alternates: fromAlt, participantAlt, addressingMode)
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
  │    ├─ parseAgentTargeting(text, agentName)
  │    ├─ If not targeted (@name, @ai, @agent, /ask) → skip
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
index.ts sendResponse callback
  └─ whatsapp.sendMessage(jid, text)
       │
       ▼
WhatsAppClient.sendMessage()
  ├─ formatMessageWithAgentName() → "[🤖 Name@host folder/]\ntext"
  ├─ chunkMessage() → splits if > 4000 chars
  └─ sock.sendMessage() for each chunk
```

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
