import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { resolve, dirname } from 'path'
import { ConfigSchema, type Config, type SettingSource } from '../types.ts'
import { resolveModelShorthand } from '../claude/utils.ts'
import { generateAgentIdentity, normalizeAgentName } from '../utils/agent-name.ts'
import { CONFIG_FILE_NAME } from '../constants.ts'

function expandPath(path: string): string {
    if (path.startsWith('~')) {
        return resolve(homedir(), path.slice(2))
    }
    return resolve(path)
}

/**
 * Get the config path in the working directory
 */
export function getLocalConfigPath(directory?: string): string {
    return resolve(directory || process.cwd(), CONFIG_FILE_NAME)
}

/**
 * Properties that should be saved to config file (excludes runtime-only properties)
 */
type SaveableConfigKey =
    | 'whitelist'
    | 'directory'
    | 'mode'
    | 'sessionPath'
    | 'model'
    | 'maxTurns'
    | 'processMissed'
    | 'missedThresholdMins'
    | 'verbose'
    | 'agentName'
    | 'systemPrompt'
    | 'systemPromptAppend'
    | 'settingSources'
    | 'keepAliveIntervalMs'
    | 'sendReadyTimeoutMs'
    | 'suppressStartupAnnouncement'
    | 'hideAgentPrefix'
    | 'ackOnTarget'
    | 'ackOnTargetEmoji'

const SAVEABLE_KEYS: SaveableConfigKey[] = [
    'whitelist',
    'directory',
    'mode',
    'sessionPath',
    'model',
    'maxTurns',
    'processMissed',
    'missedThresholdMins',
    'verbose',
    'agentName',
    'systemPrompt',
    'systemPromptAppend',
    'settingSources',
    'keepAliveIntervalMs',
    'sendReadyTimeoutMs',
    'suppressStartupAnnouncement',
    'hideAgentPrefix',
    'ackOnTarget',
    'ackOnTargetEmoji'
]

/**
 * Save configuration to a file.
 * By default saves to the working directory (config.directory/.whatsapp-claude-agent.json).
 */
export function saveConfigFile(config: Config, configPath?: string): string {
    const path = configPath || getLocalConfigPath(config.directory)
    const expandedPath = expandPath(path)

    // Ensure directory exists
    const dir = dirname(expandedPath)
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }

    // Build saveable config (exclude runtime-only properties like resumeSessionId, forkSession)
    const saveableConfig: Partial<Config> = {}
    for (const key of SAVEABLE_KEYS) {
        if (config[key] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(saveableConfig as any)[key] = config[key]
        }
    }

    writeFileSync(expandedPath, JSON.stringify(saveableConfig, null, 4), 'utf-8')
    return expandedPath
}

/**
 * Options that can be passed to config init
 */
export interface ConfigInitOptions {
    whitelist?: string[]
    directory?: string
    mode?: string
    sessionPath?: string
    model?: string
    maxTurns?: number
    processMissed?: boolean
    missedThresholdMins?: number
    verbose?: boolean
    agentName?: string
    systemPrompt?: string
    systemPromptAppend?: string
    settingSources?: string[]
    keepAliveIntervalMs?: number
    sendReadyTimeoutMs?: number
    suppressStartupAnnouncement?: boolean
    hideAgentPrefix?: boolean
    ackOnTarget?: boolean
    ackOnTargetEmoji?: string
}

/**
 * Generate a template config file content
 */
export function generateConfigTemplate(options?: ConfigInitOptions): string {
    const template: Record<string, unknown> = {
        directory: options?.directory ?? process.cwd(),
        mode: options?.mode ?? 'default',
        model: options?.model ?? 'sonnet',
        verbose: options?.verbose ?? false
    }

    // Add optional fields only if provided
    if (options?.whitelist && options.whitelist.length > 0) {
        template['whitelist'] = options.whitelist
    }
    if (options?.sessionPath) {
        template['sessionPath'] = options.sessionPath
    }
    if (options?.maxTurns !== undefined) {
        template['maxTurns'] = options.maxTurns
    }
    if (options?.processMissed !== undefined) {
        template['processMissed'] = options.processMissed
    }
    if (options?.missedThresholdMins !== undefined) {
        template['missedThresholdMins'] = options.missedThresholdMins
    }
    if (options?.agentName) {
        template['agentName'] = options.agentName
    }
    if (options?.systemPrompt) {
        template['systemPrompt'] = options.systemPrompt
    }
    if (options?.systemPromptAppend) {
        template['systemPromptAppend'] = options.systemPromptAppend
    }
    if (options?.settingSources && options.settingSources.length > 0) {
        template['settingSources'] = options.settingSources
    }
    if (options?.keepAliveIntervalMs !== undefined) {
        template['keepAliveIntervalMs'] = options.keepAliveIntervalMs
    }
    if (options?.sendReadyTimeoutMs !== undefined) {
        template['sendReadyTimeoutMs'] = options.sendReadyTimeoutMs
    }
    if (options?.suppressStartupAnnouncement !== undefined) {
        template['suppressStartupAnnouncement'] = options.suppressStartupAnnouncement
    }
    if (options?.hideAgentPrefix !== undefined) {
        template['hideAgentPrefix'] = options.hideAgentPrefix
    }
    if (options?.ackOnTarget !== undefined) {
        template['ackOnTarget'] = options.ackOnTarget
    }
    if (options?.ackOnTargetEmoji !== undefined) {
        template['ackOnTargetEmoji'] = options.ackOnTargetEmoji
    }

    return JSON.stringify(template, null, 4)
}

/**
 * Load config from a file.
 * If configPath is provided, loads from that path.
 * Otherwise, loads from the working directory .whatsapp-claude-agent.json.
 */
export function loadConfigFile(configPath?: string, directory?: string): Partial<Config> {
    const path = configPath || getLocalConfigPath(directory)
    const expandedPath = expandPath(path)

    if (!existsSync(expandedPath)) {
        return {}
    }

    try {
        const content = readFileSync(expandedPath, 'utf-8')
        return JSON.parse(content) as Partial<Config>
    } catch {
        console.warn(`Warning: Could not parse config file at ${expandedPath}`)
        return {}
    }
}

export interface CLIOptions {
    directory?: string
    mode?: string
    whitelist?: string
    session?: string
    model?: string
    maxTurns?: string
    processMissed?: boolean
    missedThreshold?: string
    verbose?: boolean
    config?: string
    systemPrompt?: string
    systemPromptAppend?: string
    loadClaudeMd?: string
    resume?: string
    fork?: boolean
    agentName?: string
    joinWhatsappGroup?: string
    allowAllGroupParticipants?: boolean
    keepAliveInterval?: string
    sendReadyTimeout?: string
    suppressStartupAnnouncement?: boolean
    hideAgentPrefix?: boolean
    ackOnTarget?: boolean
    ackOnTargetEmoji?: string
}

export function parseConfig(cliOptions: CLIOptions): Config {
    // Resolve directory early since we need it for config loading and agent name generation
    const directory = expandPath(cliOptions.directory || process.cwd())

    // Load config file from working directory (or explicit path)
    const fileConfig = loadConfigFile(cliOptions.config, directory)

    // Resolve model shorthand (from CLI or file config)
    const rawModel = cliOptions.model || fileConfig.model
    let resolvedModel: string | undefined
    if (rawModel) {
        resolvedModel = resolveModelShorthand(rawModel)
        if (!resolvedModel) {
            console.warn(
                `Warning: Unrecognized model "${rawModel}". Using default model instead.\n` +
                    'Valid shorthands: opus, sonnet, haiku, opus-4.5, sonnet-4, etc.'
            )
        }
    }

    // Resolve agent name: CLI option > config file > undefined (will generate random)
    const customAgentName =
        normalizeAgentName(cliOptions.agentName) || normalizeAgentName(fileConfig.agentName)

    // Generate agent identity with all components
    const agentIdentity = generateAgentIdentity(directory, customAgentName)

    // Build merged config (CLI options override file config)
    const merged = {
        directory: cliOptions.directory || fileConfig.directory,
        mode: cliOptions.mode || fileConfig.mode,
        whitelist: cliOptions.whitelist
            ? cliOptions.whitelist.split(',').map((n) => n.trim())
            : fileConfig.whitelist,
        sessionPath: cliOptions.session
            ? expandPath(cliOptions.session)
            : fileConfig.sessionPath
              ? expandPath(fileConfig.sessionPath)
              : undefined,
        model: resolvedModel,
        maxTurns: cliOptions.maxTurns ? parseInt(cliOptions.maxTurns, 10) : fileConfig.maxTurns,
        processMissed: cliOptions.processMissed ?? fileConfig.processMissed,
        missedThresholdMins: cliOptions.missedThreshold
            ? parseInt(cliOptions.missedThreshold, 10)
            : fileConfig.missedThresholdMins,
        verbose: cliOptions.verbose ?? fileConfig.verbose,
        systemPrompt: cliOptions.systemPrompt || fileConfig.systemPrompt,
        systemPromptAppend: cliOptions.systemPromptAppend || fileConfig.systemPromptAppend,
        settingSources: cliOptions.loadClaudeMd
            ? (cliOptions.loadClaudeMd.split(',').map((s) => s.trim()) as SettingSource[])
            : fileConfig.settingSources,
        resumeSessionId: cliOptions.resume || fileConfig.resumeSessionId,
        forkSession: cliOptions.fork ?? fileConfig.forkSession,
        agentName: customAgentName, // Keep for config file compatibility
        agentIdentity,
        // Runtime-only: group join (never from file config)
        joinWhatsAppGroup: cliOptions.joinWhatsappGroup,
        allowAllGroupParticipants: cliOptions.allowAllGroupParticipants,
        keepAliveIntervalMs: cliOptions.keepAliveInterval
            ? parseInt(cliOptions.keepAliveInterval, 10)
            : fileConfig.keepAliveIntervalMs,
        sendReadyTimeoutMs: cliOptions.sendReadyTimeout
            ? parseInt(cliOptions.sendReadyTimeout, 10)
            : fileConfig.sendReadyTimeoutMs,
        suppressStartupAnnouncement:
            cliOptions.suppressStartupAnnouncement ?? fileConfig.suppressStartupAnnouncement,
        hideAgentPrefix: cliOptions.hideAgentPrefix ?? fileConfig.hideAgentPrefix,
        ackOnTarget: cliOptions.ackOnTarget ?? fileConfig.ackOnTarget,
        ackOnTargetEmoji: cliOptions.ackOnTargetEmoji ?? fileConfig.ackOnTargetEmoji
    }

    // Filter out undefined values
    const filtered = Object.fromEntries(Object.entries(merged).filter(([_, v]) => v !== undefined))

    // Validate and apply defaults
    const result = ConfigSchema.safeParse(filtered)

    if (!result.success) {
        const errors = result.error.issues
            .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
            .join('\n')
        throw new Error(`Configuration validation failed:\n${errors}`)
    }

    // Expand paths in the final config
    const config = result.data
    config.directory = expandPath(config.directory)
    config.sessionPath = expandPath(config.sessionPath)

    return config
}
