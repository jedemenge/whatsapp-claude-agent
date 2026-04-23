import { EventEmitter } from 'events'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ConversationHistory } from './history.ts'
import { MessageQueue } from './queue.ts'
import type { ClaudeBackend } from '../claude/backend.ts'
import { PermissionManager } from '../claude/permissions.ts'
import { getModelShorthand } from '../claude/utils.ts'
import { isCommand, parseCommand } from '../whatsapp/messages.ts'
import {
    getLocalConfigPath,
    loadConfigFile,
    saveConfigFile,
    generateConfigTemplate
} from '../cli/config.ts'
import type {
    Config,
    IncomingMessage,
    PermissionMode,
    SettingSource,
    AgentEvent
} from '../types.ts'
import type { Logger } from '../utils/logger.ts'
import type { WhatsAppClient } from '../whatsapp/client.ts'
import { parseAgentTargeting } from '../utils/agent-name.ts'

/**
 * Config properties that require a new session when changed.
 * Sessions are tied to: directory, model, and system prompt configuration.
 */
export const SESSION_INVALIDATING_KEYS: (keyof Config)[] = [
    'directory',
    'model',
    'systemPrompt',
    'systemPromptAppend'
]

/**
 * Human-readable descriptions for session-invalidating properties
 */
const SESSION_INVALIDATING_DESCRIPTIONS: Record<string, string> = {
    directory: 'working directory',
    model: 'model',
    systemPrompt: 'system prompt',
    systemPromptAppend: 'system prompt append'
}

export class ConversationManager extends EventEmitter {
    private history: ConversationHistory
    private queue: MessageQueue
    private permissions: PermissionManager
    private backend: ClaudeBackend
    private config: Config
    private logger: Logger
    private whatsappClient: WhatsAppClient | null = null

    constructor(backend: ClaudeBackend, config: Config, logger: Logger) {
        super()
        this.backend = backend
        this.config = config
        this.logger = logger
        this.history = new ConversationHistory()
        this.queue = new MessageQueue(logger)
        this.permissions = new PermissionManager(logger)

        // Wire up permission requests
        this.backend.setPermissionCallback((toolName, description, input) =>
            this.permissions.requestPermission(toolName, description, input)
        )

        this.permissions.on('permission-request', (request) => {
            this.emit('event', { type: 'permission-request', request } as AgentEvent)
        })
    }

    /**
     * Set WhatsApp client reference (for accessing group config)
     */
    setWhatsAppClient(client: WhatsAppClient): void {
        this.whatsappClient = client
    }

    /**
     * Handle an incoming message
     */
    async handleMessage(
        message: IncomingMessage,
        sendResponse: (text: string) => Promise<void>,
        sendTyping: () => Promise<void>
    ): Promise<void> {
        // In group mode, check if message is targeted at this agent first
        const groupConfig = this.whatsappClient?.getGroupConfig()
        let messageText = message.text

        if (groupConfig && message.isGroupMessage) {
            const targeting = parseAgentTargeting(message.text, this.config.agentIdentity.name)

            if (!targeting.isTargeted) {
                // Not targeted at this agent - ignore silently
                this.logger.debug(
                    `Group message not targeted at this agent. Use @${this.config.agentIdentity.name}, @ai, @agent, or /ask`
                )
                return
            }

            // Use the cleaned message (without the targeting prefix)
            messageText = targeting.cleanMessage
            this.logger.debug(`Message targeted via ${targeting.method}: "${messageText}"`)

            // If message is empty after stripping targeting, ignore
            if (!messageText.trim()) {
                return
            }

            // Update the message object with cleaned text for processing
            message = { ...message, text: messageText }
        }

        // Check if this is a permission response (after targeting check for group mode)
        if (this.permissions.pendingCount > 0) {
            const resolved = this.permissions.tryResolveFromMessage(message.text)
            if (resolved) {
                return
            }
        }

        // Check for commands
        if (isCommand(message.text)) {
            await this.handleCommand(message, sendResponse)
            return
        }

        // Regular message - process with Claude
        await this.processWithClaude(message, sendResponse, sendTyping)
    }

    private async handleCommand(
        message: IncomingMessage,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        const parsed = parseCommand(message.text)
        if (!parsed) return

        switch (parsed.command) {
            case 'clear':
                this.history.clear()
                await sendResponse('✓ Conversation cleared.')
                break

            case 'readonly':
            case 'plan':
                this.setMode('plan')
                await sendResponse('✓ Switched to *plan* mode. Claude can only read files.')
                break

            case 'normal':
            case 'default':
                this.setMode('default')
                await sendResponse(
                    '✓ Switched to *default* mode. Claude will ask permission for writes.'
                )
                break

            case 'acceptedits':
            case 'accept-edits':
                this.setMode('acceptEdits')
                await sendResponse(
                    '✓ Switched to *acceptEdits* mode. Claude can edit files without asking.'
                )
                break

            case 'yolo':
            case 'bypass':
            case 'bypasspermissions':
                this.setMode('bypassPermissions')
                await sendResponse(
                    '⚠️ Switched to *bypassPermissions* mode. Claude has full access without confirmation!'
                )
                break

            case 'dontask':
            case 'dont-ask':
                this.setMode('dontAsk')
                await sendResponse(
                    '✓ Switched to *dontAsk* mode. Claude will not prompt, denies if not pre-approved.'
                )
                break

            case 'mode':
                await sendResponse(`Current mode: *${this.config.mode}*`)
                break

            case 'help':
                await sendResponse(this.getHelpMessage())
                break

            case 'status':
                await sendResponse(this.getStatusMessage())
                break

            case 'systemprompt':
            case 'prompt':
                await this.handleSystemPromptCommand(parsed.args, sendResponse)
                break

            case 'promptappend':
            case 'appendprompt':
                await this.handlePromptAppendCommand(parsed.args, sendResponse)
                break

            case 'claudemd':
            case 'settings':
                await this.handleClaudeMdCommand(parsed.args, sendResponse)
                break

            case 'session':
                await this.handleSessionCommand(parsed.args, sendResponse)
                break

            case 'fork':
                await this.handleForkCommand(sendResponse)
                break

            case 'cd':
            case 'dir':
            case 'directory':
                await this.handleDirectoryCommand(parsed.args, sendResponse)
                break

            case 'model':
                await this.handleModelCommand(parsed.args, sendResponse)
                break

            case 'models':
                await this.handleModelsCommand(sendResponse)
                break

            case 'name':
            case 'agentname':
            case 'agent-name':
                await this.handleNameCommand(parsed.args, sendResponse)
                break

            case 'config':
                await this.handleConfigCommand(parsed.args, sendResponse)
                break

            case 'agent':
                await sendResponse(this.getAgentInfoMessage())
                break

            case 'reload':
                await this.handleReloadCommand(sendResponse)
                break

            default:
                await sendResponse(
                    `Unknown command: /${parsed.command}\n\nType /help for available commands.`
                )
        }
    }

    private async handleSystemPromptCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        if (!args) {
            const config = this.backend.getSystemPromptConfig()
            if (config.systemPrompt) {
                await sendResponse(
                    `*Current system prompt:*\n\n${config.systemPrompt.slice(0, 500)}${config.systemPrompt.length > 500 ? '...' : ''}`
                )
            } else if (config.systemPromptAppend) {
                await sendResponse(
                    `*System prompt append:*\n\n${config.systemPromptAppend.slice(0, 500)}${config.systemPromptAppend.length > 500 ? '...' : ''}`
                )
            } else {
                await sendResponse('Using default Claude Code system prompt.')
            }
            return
        }

        if (args.toLowerCase() === 'clear' || args.toLowerCase() === 'reset') {
            this.backend.setSystemPrompt(undefined)
            const sessionMsg = this.invalidateSessionWithMessage('system prompt changed')
            await sendResponse(`✓ System prompt reset to default.${sessionMsg}`)
            return
        }

        this.backend.setSystemPrompt(args)
        const sessionMsg = this.invalidateSessionWithMessage('system prompt changed')
        await sendResponse(`✓ System prompt set (${args.length} chars).${sessionMsg}`)
    }

    private async handlePromptAppendCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        if (!args) {
            const config = this.backend.getSystemPromptConfig()
            if (config.systemPromptAppend) {
                await sendResponse(
                    `*Current prompt append:*\n\n${config.systemPromptAppend.slice(0, 500)}${config.systemPromptAppend.length > 500 ? '...' : ''}`
                )
            } else {
                await sendResponse('No text appended to system prompt.')
            }
            return
        }

        if (args.toLowerCase() === 'clear' || args.toLowerCase() === 'reset') {
            this.backend.setSystemPromptAppend(undefined)
            const sessionMsg = this.invalidateSessionWithMessage('system prompt append changed')
            await sendResponse(`✓ Prompt append cleared.${sessionMsg}`)
            return
        }

        this.backend.setSystemPromptAppend(args)
        const sessionMsg = this.invalidateSessionWithMessage('system prompt append changed')
        await sendResponse(
            `✓ Text will be appended to default system prompt (${args.length} chars).${sessionMsg}`
        )
    }

    private async handleSessionCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        const currentSessionId = this.backend.getSessionId()

        if (!args) {
            // Show current session info
            if (currentSessionId) {
                await sendResponse(
                    `*Current Session:*\n\n\`${currentSessionId}\`\n\nUse this ID with \`--resume\` to continue this conversation later.`
                )
            } else {
                await sendResponse(
                    'No active session yet. Send a message to Claude to start a session.'
                )
            }
            return
        }

        if (args.toLowerCase() === 'clear' || args.toLowerCase() === 'new') {
            this.backend.setSessionId(undefined)
            this.history.clear()
            await sendResponse(
                '✓ Session cleared. A new session will be started on the next message.'
            )
            return
        }

        // Set a session ID for resumption
        this.backend.setSessionId(args)
        await sendResponse(
            `✓ Session set to: \`${args}\`\n\nNext message will resume this session.`
        )
    }

    private async handleForkCommand(sendResponse: (text: string) => Promise<void>): Promise<void> {
        const currentSessionId = this.backend.getSessionId()

        if (!currentSessionId) {
            await sendResponse(
                '❌ No active session to fork. Start a conversation first, then use /fork to branch it.'
            )
            return
        }

        // Enable forking for the next query
        this.backend.setForkSession(true)
        await sendResponse(
            `✓ Fork enabled for session \`${currentSessionId}\`.\n\nYour next message will create a new branch from this session. The original session remains unchanged.`
        )
    }

    private async handleDirectoryCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        if (!args) {
            // Show current working directory
            const currentDir = this.backend.getDirectory()
            await sendResponse(`📁 Working directory: \`${currentDir}\``)
            return
        }

        // Expand ~ to home directory
        let targetPath = args
        if (targetPath.startsWith('~')) {
            targetPath = resolve(homedir(), targetPath.slice(2))
        } else {
            targetPath = resolve(targetPath)
        }

        // Validate the path exists and is a directory
        if (!existsSync(targetPath)) {
            await sendResponse(`❌ Directory not found: \`${targetPath}\``)
            return
        }

        try {
            const stats = statSync(targetPath)
            if (!stats.isDirectory()) {
                await sendResponse(`❌ Path is not a directory: \`${targetPath}\``)
                return
            }
        } catch {
            await sendResponse(`❌ Cannot access path: \`${targetPath}\``)
            return
        }

        // Change the directory
        this.backend.setDirectory(targetPath)
        this.config.directory = targetPath

        const sessionMsg = this.invalidateSessionWithMessage('working directory changed')
        await sendResponse(`✓ Working directory changed to: \`${targetPath}\`${sessionMsg}`)
    }

    private async handleModelCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        if (!args) {
            // Show current model
            const currentModel = this.backend.getModel()
            await sendResponse(
                `🤖 Current model: \`${currentModel}\`\n\nUse /models to see available models.\nShorthands: opus, sonnet, haiku, opus-4.5, sonnet-4, etc.`
            )
            return
        }

        const requestedInput = args.trim()

        // Resolve shorthand to full model ID (returns undefined if not recognized)
        const resolvedModel = this.backend.resolveModelShorthand(requestedInput)

        // If not recognized, don't change the model
        if (!resolvedModel) {
            await sendResponse(
                `❌ Unknown model: \`${requestedInput}\`\n\nUse /models to see available models.\nShorthands: opus, sonnet, haiku, opus-4.5, sonnet-4, etc.`
            )
            return
        }

        // Change the model
        this.backend.setModel(resolvedModel)
        this.config.model = resolvedModel

        const baseResponse =
            requestedInput !== resolvedModel
                ? `✓ Model changed to: \`${resolvedModel}\` (from "${requestedInput}")`
                : `✓ Model changed to: \`${resolvedModel}\``
        const sessionMsg = this.invalidateSessionWithMessage('model changed')
        await sendResponse(`${baseResponse}${sessionMsg}`)
    }

    private async handleModelsCommand(
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        const availableModels = this.backend.getAvailableModels()
        const currentModel = this.backend.getModel()

        const modelList = availableModels
            .map((m) => {
                const shorthand = getModelShorthand(m)
                const displayName = shorthand ? `${shorthand} (${m})` : m
                return m === currentModel
                    ? `• \`${displayName}\` ✓ (current)`
                    : `• \`${displayName}\``
            })
            .join('\n')

        await sendResponse(
            `*Available Models:*\n\n${modelList}\n\nUse \`/model <shorthand>\` to switch (e.g., \`/model opus-4-5\`).`
        )
    }

    private async handleNameCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        if (!args) {
            // Show current agent identity
            const { name, host, folder } = this.config.agentIdentity
            await sendResponse(
                `🤖 Agent identity:\n• Name: *${name}*\n• Host: ${host}\n• Folder: ${folder}/`
            )
            return
        }

        const newName = args.trim()
        if (newName.length === 0) {
            await sendResponse('❌ Agent name cannot be empty.')
            return
        }

        // Change the agent name (only updates the name component)
        this.backend.setAgentName(newName)
        this.config.agentIdentity.name = newName
        this.config.agentName = newName

        await sendResponse(`✓ Agent name changed to: *${newName}*`)
    }

    private async handleClaudeMdCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        const validSources: SettingSource[] = ['user', 'project', 'local']

        if (!args) {
            const sources = this.backend.getSettingSources()
            if (sources && sources.length > 0) {
                await sendResponse(`*CLAUDE.md sources:* ${sources.join(', ')}`)
            } else {
                await sendResponse(
                    'No CLAUDE.md sources configured. Use `/claudemd user,project` to enable.'
                )
            }
            return
        }

        if (args.toLowerCase() === 'clear' || args.toLowerCase() === 'none') {
            this.backend.setSettingSources(undefined)
            await sendResponse('✓ CLAUDE.md loading disabled.')
            return
        }

        const requestedSources = args
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0)

        const invalid = requestedSources.filter((s) => !validSources.includes(s as SettingSource))
        if (invalid.length > 0) {
            await sendResponse(
                `❌ Invalid sources: ${invalid.join(', ')}\n\nValid sources: user, project, local`
            )
            return
        }

        this.backend.setSettingSources(requestedSources as SettingSource[])
        await sendResponse(`✓ CLAUDE.md sources set to: ${requestedSources.join(', ')}`)
    }

    private async handleConfigCommand(
        args: string,
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        const subcommand = args.trim().toLowerCase()
        const configPath = getLocalConfigPath(this.config.directory)

        if (!subcommand || subcommand === 'show' || subcommand === 'list') {
            // Show current configuration
            await sendResponse(this.getConfigDisplay())
            return
        }

        if (subcommand === 'path') {
            // Show config file path
            const exists = existsSync(configPath)
            await sendResponse(
                `📁 Config file path:\n\`${configPath}\`\n\n${exists ? '✓ File exists' : '⚠️ File does not exist'}`
            )
            return
        }

        if (subcommand === 'save') {
            // Save current runtime config to file
            try {
                const savedPath = saveConfigFile(this.config)
                await sendResponse(`✓ Configuration saved to:\n\`${savedPath}\``)
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error)
                await sendResponse(`❌ Failed to save config: ${errorMsg}`)
            }
            return
        }

        if (subcommand === 'generate' || subcommand === 'template') {
            // Generate a template config
            const template = generateConfigTemplate({ whitelist: this.config.whitelist })
            await sendResponse(
                `*Config template:*\n\n\`\`\`json\n${template}\n\`\`\`\n\nSave this to:\n\`${configPath}\``
            )
            return
        }

        if (subcommand === 'reload') {
            // Redirect to /reload command
            await this.handleReloadCommand(sendResponse)
            return
        }

        // Unknown subcommand
        await sendResponse(`Unknown config command: ${subcommand}

*Available /config commands:*
/config - Show current runtime configuration
/config show - Same as above
/config path - Show config file location
/config save - Save current config to file
/config generate - Generate a config template

Use \`/reload\` to reload and apply config from disk.`)
    }

    private getConfigDisplay(): string {
        const promptConfig = this.backend.getSystemPromptConfig()
        const sources = this.backend.getSettingSources()

        let promptStatus = 'default'
        if (promptConfig.systemPrompt) {
            promptStatus = `custom (${promptConfig.systemPrompt.length} chars)`
        } else if (promptConfig.systemPromptAppend) {
            promptStatus = `default + append (${promptConfig.systemPromptAppend.length} chars)`
        }

        const claudeMdStatus = sources?.length ? sources.join(', ') : 'disabled'

        return `*Current Configuration:*

*Core Settings:*
• whitelist: ${this.config.whitelist.join(', ')}
• directory: \`${this.config.directory}\`
• mode: ${this.config.mode}
• model: ${this.config.model}

*Message Processing:*
• processMissed: ${this.config.processMissed}
• missedThresholdMins: ${this.config.missedThresholdMins}
• maxTurns: ${this.config.maxTurns ?? 'unlimited'}

*Agent Identity:*
• name: ${this.config.agentIdentity.name}
• host: ${this.config.agentIdentity.host}
• folder: ${this.config.agentIdentity.folder}
• verbose: ${this.config.verbose}

*Prompts & Settings:*
• systemPrompt: ${promptStatus}
• settingSources: ${claudeMdStatus}

Use \`/config save\` to save to file.`
    }

    private async processWithClaude(
        message: IncomingMessage,
        sendResponse: (text: string) => Promise<void>,
        sendTyping: () => Promise<void>
    ): Promise<void> {
        this.logger.info('Processing message with Claude...')

        // Indicate typing
        await sendTyping()

        // Add to history
        this.history.addUserMessage(message)

        // Track whether the primary send was reached so the catch branch does
        // not re-invoke a known-broken send path. Previous behaviour
        // double-threw when the socket was down and crashed the process.
        let primarySendAttempted = false
        try {
            // Query Claude
            this.logger.info('Sending query to Claude backend...')
            const response = await this.backend.query(message.text, this.history.getHistory())
            this.logger.info(`Claude response received (${response.text.length} chars)`)

            if (response.error) {
                primarySendAttempted = true
                await sendResponse(`❌ Error: ${response.error}`)
                return
            }

            // Add response to history
            this.history.addAssistantMessage(response.text)

            // Log tools used (verbose only)
            if (response.toolsUsed && response.toolsUsed.length > 0) {
                this.logger.debug(`Tools used: ${response.toolsUsed.join(', ')}`)
            }

            primarySendAttempted = true
            await sendResponse(response.text)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            this.logger.error(`Error processing message: ${errorMessage}`)
            // Only notify the user over WhatsApp if the failure was NOT in the
            // send path itself — otherwise we'd retry on the exact same dead
            // socket. When the primary send already ran (or failed), the outer
            // boundary in index.ts has logged the undelivered text.
            if (!primarySendAttempted) {
                try {
                    await sendResponse(`❌ An error occurred: ${errorMessage}`)
                } catch (sendErr) {
                    const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
                    this.logger.error(`Failed to deliver error notification to user: ${sendErrMsg}`)
                }
            }
        }
    }

    private setMode(mode: PermissionMode): void {
        this.config.mode = mode
        this.backend.setMode(mode)
        this.logger.info(`Mode changed to: ${mode}`)
    }

    /**
     * Resolve a pending permission request
     */
    resolvePermission(requestId: string, allowed: boolean): boolean {
        return this.permissions.resolvePermission(requestId, allowed)
    }

    private getHelpMessage(): string {
        const groupConfig = this.whatsappClient?.getGroupConfig()
        const { name } = this.config.agentIdentity

        let help = ''

        if (groupConfig) {
            help += `*Targeting (required in group):*
@${name} <message> - Target by name
@ai <message> - Generic AI target
@agent <message> - Generic agent target
/ask <message> - Ask command

`
        }

        help += `*Available Commands:*

*Session & Directory:*
/agent - Check if agent is online
/clear - Clear conversation history
/status - Show agent status
/session - Show current session ID
/session <id> - Set session ID to resume
/session clear - Start a new session
/fork - Fork current session (branch off)
/cd - Show current working directory
/cd <path> - Change working directory
/help - Show this help message

*Agent & Model:*
/name - Show current agent name
/name <name> - Change agent name
/model - Show current model
/model <name> - Switch to a different model
/models - List all available models

*Permission Modes:*
/mode - Show current permission mode
/plan - Switch to plan mode (read-only)
/default - Switch to default mode (asks for permission)
/acceptEdits - Auto-accept file edits
/bypass - Bypass all permissions (dangerous!)
/dontAsk - Deny if not pre-approved

*System Prompt:*
/prompt - Show current system prompt
/prompt <text> - Set custom system prompt
/prompt clear - Reset to default
/promptappend <text> - Append to default prompt
/promptappend clear - Clear append

*CLAUDE.md Settings:*
/claudemd - Show current sources
/claudemd user,project - Load user & project CLAUDE.md
/claudemd clear - Disable CLAUDE.md loading

*Configuration File:*
/config - Show current runtime config
/config path - Show config file location
/config save - Save current config to file
/config generate - Generate a config template
/reload - Reload and apply config from disk

*Valid CLAUDE.md sources:* user, project, local

*Session-invalidating changes:* directory, model, systemPrompt, systemPromptAppend`

        return help
    }

    private getAgentInfoMessage(): string {
        const groupConfig = this.whatsappClient?.getGroupConfig()
        const chatMode = groupConfig ? 'Group' : 'Private'
        const { name, host } = this.config.agentIdentity

        let message = `*Agent Online*

🤖 Name: *${name}*
🖥️ Host: ${host}
📁 Directory: ${this.config.directory}
🔐 Mode: ${this.config.mode}
🧠 Model: ${this.config.model}
💬 Chat: ${chatMode}`

        if (groupConfig) {
            message += `

*Target me with:*
• @${name} <message>
• @ai <message>
• @agent <message>
• /ask <message>`
        } else {
            message += `

Type */help* for available commands.`
        }

        return message
    }

    private getStatusMessage(): string {
        const promptConfig = this.backend.getSystemPromptConfig()
        const sources = this.backend.getSettingSources()
        const sessionId = this.backend.getSessionId()
        const groupConfig = this.whatsappClient?.getGroupConfig()
        const { name, host } = this.config.agentIdentity

        let promptStatus = 'default'
        if (promptConfig.systemPrompt) {
            promptStatus = `custom (${promptConfig.systemPrompt.length} chars)`
        } else if (promptConfig.systemPromptAppend) {
            promptStatus = `default + append (${promptConfig.systemPromptAppend.length} chars)`
        }

        const claudeMdStatus = sources?.length ? sources.join(', ') : 'disabled'
        const sessionStatus = sessionId ? `\`${sessionId}\`` : 'none (new session)'
        const chatModeStatus = groupConfig
            ? `Group: \`${groupConfig.groupJid}\``
            : 'Private messages'

        return `*Agent Status:*

🤖 Name: *${name}*
🖥️ Host: ${host}
📁 Directory: ${this.config.directory}
🔐 Mode: ${this.config.mode}
🧠 Model: ${this.config.model}
🔗 Session: ${sessionStatus}
💬 Conversation length: ${this.history.length} messages
⏳ Pending permissions: ${this.permissions.pendingCount}
📝 System prompt: ${promptStatus}
📄 CLAUDE.md sources: ${claudeMdStatus}
👥 Chat mode: ${chatModeStatus}`
    }

    /**
     * Check which session-invalidating config properties have changed
     * @returns Array of changed property names, empty if no session-invalidating changes
     */
    private getSessionInvalidatingChanges(
        oldConfig: Partial<Config>,
        newConfig: Partial<Config>
    ): string[] {
        const changes: string[] = []
        for (const key of SESSION_INVALIDATING_KEYS) {
            const oldVal = oldConfig[key]
            const newVal = newConfig[key]
            if (oldVal !== newVal) {
                changes.push(SESSION_INVALIDATING_DESCRIPTIONS[key] || key)
            }
        }
        return changes
    }

    /**
     * Invalidate the current session if there is one.
     * Clears session ID and conversation history.
     * @returns true if a session was invalidated, false if no session was active
     */
    private invalidateSession(): boolean {
        const currentSessionId = this.backend.getSessionId()
        if (currentSessionId) {
            this.backend.setSessionId(undefined)
            this.history.clear()
            this.logger.info('Session invalidated')
            return true
        }
        return false
    }

    /**
     * Invalidate session if needed and return a message suffix explaining why
     * @returns Message suffix to append, or empty string if no session was invalidated
     */
    private invalidateSessionWithMessage(reason: string): string {
        if (this.invalidateSession()) {
            return `\n\n⚠️ Session cleared (${reason}). A new session will start with your next message.`
        }
        return ''
    }

    /**
     * Handle /reload command - reload configuration from disk
     */
    private async handleReloadCommand(
        sendResponse: (text: string) => Promise<void>
    ): Promise<void> {
        const configPath = getLocalConfigPath(this.config.directory)

        // Check if config file exists
        if (!existsSync(configPath)) {
            await sendResponse(
                `❌ No config file found at \`${configPath}\`\n\nUse \`/config save\` to create one first.`
            )
            return
        }

        // Load config from disk
        let newConfig: Partial<Config>
        try {
            newConfig = loadConfigFile(undefined, this.config.directory)
        } catch (error) {
            await sendResponse(
                `❌ Failed to load config: ${error instanceof Error ? error.message : String(error)}`
            )
            return
        }

        // Track what changed
        const changes: string[] = []
        const sessionInvalidatingChanges = this.getSessionInvalidatingChanges(
            this.config,
            newConfig
        )

        // Apply changes
        if (newConfig.directory !== undefined && newConfig.directory !== this.config.directory) {
            // Validate new directory
            if (!existsSync(newConfig.directory)) {
                await sendResponse(`❌ Directory not found: \`${newConfig.directory}\``)
                return
            }
            this.backend.setDirectory(newConfig.directory)
            this.config.directory = newConfig.directory
            changes.push(`directory → \`${newConfig.directory}\``)
        }

        if (newConfig.model !== undefined && newConfig.model !== this.config.model) {
            const resolved = this.backend.resolveModelShorthand(newConfig.model)
            if (resolved) {
                this.backend.setModel(resolved)
                this.config.model = resolved
                changes.push(`model → \`${resolved}\``)
            }
        }

        if (newConfig.mode !== undefined && newConfig.mode !== this.config.mode) {
            this.setMode(newConfig.mode)
            changes.push(`mode → \`${newConfig.mode}\``)
        }

        if (
            newConfig.systemPrompt !== undefined &&
            newConfig.systemPrompt !== this.config.systemPrompt
        ) {
            this.backend.setSystemPrompt(newConfig.systemPrompt || undefined)
            changes.push(newConfig.systemPrompt ? 'system prompt updated' : 'system prompt cleared')
        }

        if (
            newConfig.systemPromptAppend !== undefined &&
            newConfig.systemPromptAppend !== this.config.systemPromptAppend
        ) {
            this.backend.setSystemPromptAppend(newConfig.systemPromptAppend || undefined)
            changes.push(
                newConfig.systemPromptAppend
                    ? 'system prompt append updated'
                    : 'system prompt append cleared'
            )
        }

        if (newConfig.settingSources !== undefined) {
            const currentSources = this.config.settingSources?.join(',') || ''
            const newSources = newConfig.settingSources?.join(',') || ''
            if (currentSources !== newSources) {
                this.backend.setSettingSources(newConfig.settingSources)
                changes.push(`CLAUDE.md sources → \`${newSources || 'disabled'}\``)
            }
        }

        if (newConfig.agentName !== undefined && newConfig.agentName !== this.config.agentName) {
            this.backend.setAgentName(newConfig.agentName)
            this.config.agentName = newConfig.agentName
            changes.push(`agent name → \`${newConfig.agentName}\``)
        }

        if (newConfig.verbose !== undefined && newConfig.verbose !== this.config.verbose) {
            this.config.verbose = newConfig.verbose
            changes.push(`verbose → \`${newConfig.verbose}\``)
        }

        if (newConfig.maxTurns !== undefined && newConfig.maxTurns !== this.config.maxTurns) {
            this.config.maxTurns = newConfig.maxTurns
            changes.push(`max turns → \`${newConfig.maxTurns}\``)
        }

        // Build response
        if (changes.length === 0) {
            await sendResponse('✓ Config reloaded. No changes detected.')
            return
        }

        let response = `✓ Config reloaded from \`${configPath}\`\n\n*Changes applied:*\n${changes.map((c) => `• ${c}`).join('\n')}`

        // Invalidate session if needed
        if (sessionInvalidatingChanges.length > 0) {
            response += this.invalidateSessionWithMessage(
                `${sessionInvalidatingChanges.join(', ')} changed`
            )
        }

        await sendResponse(response)
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.permissions.cancelAll()
        this.queue.clear()
        this.history.clear()
    }
}
