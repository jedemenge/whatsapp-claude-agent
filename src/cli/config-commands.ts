import { Command } from 'commander'
import { existsSync } from 'fs'
import {
    loadConfigFile,
    getLocalConfigPath,
    generateConfigTemplate,
    type ConfigInitOptions
} from './config.ts'
import { ConfigSchema, type Config } from '../types.ts'
import { resolveModelShorthand } from '../claude/utils.ts'

type ConfigKey = keyof Config

const VALID_KEYS: ConfigKey[] = [
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
    'suppressStartupAnnouncement'
]

function getConfigPath(options: { config?: string; directory?: string }): string {
    if (options.config) {
        return options.config
    }
    // Use working directory config
    return getLocalConfigPath(options.directory)
}

function parseValue(key: ConfigKey, value: string): unknown {
    // Handle different types based on schema
    switch (key) {
        case 'whitelist':
        case 'settingSources':
            // Arrays: parse as comma-separated or JSON
            if (value.startsWith('[')) {
                return JSON.parse(value)
            }
            return value.split(',').map((s) => s.trim())

        case 'maxTurns':
        case 'missedThresholdMins':
        case 'keepAliveIntervalMs':
        case 'sendReadyTimeoutMs':
            return parseInt(value, 10)

        case 'verbose':
        case 'processMissed':
        case 'suppressStartupAnnouncement':
            return value === 'true' || value === '1'

        case 'model':
            return resolveModelShorthand(value) || value

        default:
            return value
    }
}

function formatValue(value: unknown): string {
    if (Array.isArray(value)) {
        return JSON.stringify(value)
    }
    if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value)
    }
    return String(value)
}

export function createConfigCommand(): Command {
    const config = new Command('config')
        .description('Manage configuration without running the agent')
        .option('-c, --config <path>', 'Config file path')
        .option(
            '-d, --directory <path>',
            'Working directory (for local .whatsapp-claude-agent.json)'
        )

    // config show
    config
        .command('show')
        .alias('list')
        .description('Show current configuration')
        .option('--json', 'Output as JSON')
        .action((options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configPath = getConfigPath(parentOpts)

            if (!existsSync(configPath)) {
                console.error(`No config file found at: ${configPath}`)
                console.error('Use "config init" to create one.')
                process.exit(1)
            }

            const fileConfig = loadConfigFile(configPath)

            if (options.json) {
                console.log(JSON.stringify(fileConfig, null, 2))
            } else {
                console.log(`Config file: ${configPath}\n`)
                for (const [key, value] of Object.entries(fileConfig)) {
                    console.log(`${key}: ${formatValue(value)}`)
                }
            }
        })

    // config get <key>
    config
        .command('get <key>')
        .description('Get a specific configuration value')
        .action((key: string, _options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configPath = getConfigPath(parentOpts)

            if (!existsSync(configPath)) {
                console.error(`No config file found at: ${configPath}`)
                process.exit(1)
            }

            const fileConfig = loadConfigFile(configPath)
            const value = fileConfig[key as ConfigKey]

            if (value === undefined) {
                console.error(`Key "${key}" not found in config.`)
                process.exit(1)
            }

            console.log(formatValue(value))
        })

    // config set <key> <value>
    config
        .command('set <key> <value>')
        .description('Set a configuration value')
        .action((key: string, value: string, _options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configPath = getConfigPath(parentOpts)

            if (!VALID_KEYS.includes(key as ConfigKey)) {
                console.error(`Invalid key: ${key}`)
                console.error(`Valid keys: ${VALID_KEYS.join(', ')}`)
                process.exit(1)
            }

            // Load existing or start fresh
            const fileConfig = existsSync(configPath) ? loadConfigFile(configPath) : {}

            // Parse and set value
            const parsedValue = parseValue(key as ConfigKey, value)
            ;(fileConfig as Record<string, unknown>)[key] = parsedValue

            // Validate
            const result = ConfigSchema.partial().safeParse(fileConfig)
            if (!result.success) {
                console.error('Validation error:')
                for (const issue of result.error.issues) {
                    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
                }
                process.exit(1)
            }

            // Save - need to cast since saveConfigFile expects full Config
            // but we're saving partial config to file
            const configDir = parentOpts.directory || process.cwd()
            const savePath = parentOpts.config || getLocalConfigPath(configDir)

            // Write directly since saveConfigFile expects full Config
            const { writeFileSync, mkdirSync } = require('fs')
            const { dirname } = require('path')
            const dir = dirname(savePath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }
            writeFileSync(savePath, JSON.stringify(fileConfig, null, 4), 'utf-8')

            console.log(`Set ${key}=${formatValue(parsedValue)}`)
            console.log(`Saved to: ${savePath}`)
        })

    // config unset <key>
    config
        .command('unset <key>')
        .alias('delete')
        .description('Remove a configuration value')
        .action((key: string, _options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configPath = getConfigPath(parentOpts)

            if (!existsSync(configPath)) {
                console.error(`No config file found at: ${configPath}`)
                process.exit(1)
            }

            const fileConfig = loadConfigFile(configPath)

            if (!(key in fileConfig)) {
                console.error(`Key "${key}" not found in config.`)
                process.exit(1)
            }

            delete (fileConfig as Record<string, unknown>)[key]

            // Write back
            const { writeFileSync } = require('fs')
            writeFileSync(configPath, JSON.stringify(fileConfig, null, 4), 'utf-8')

            console.log(`Removed: ${key}`)
            console.log(`Saved to: ${configPath}`)
        })

    // config init
    config
        .command('init')
        .description('Create a new configuration file')
        .option('--force', 'Overwrite existing config file')
        .option('-w, --whitelist <numbers>', 'Comma-separated phone numbers allowed to interact')
        .option('-m, --mode <mode>', 'Permission mode')
        .option('-s, --session <path>', 'WhatsApp session directory')
        .option('--model <model>', 'Claude model to use')
        .option('--max-turns <n>', 'Maximum conversation turns')
        .option('--process-missed', 'Process messages received while offline')
        .option('--no-process-missed', 'Ignore messages received while offline')
        .option('--missed-threshold <mins>', 'Only process messages from last N minutes')
        .option('-v, --verbose', 'Enable verbose logging')
        .option('--agent-name <name>', 'Agent identity name')
        .option('--system-prompt <prompt>', 'Custom system prompt for Claude')
        .option('--system-prompt-append <text>', 'Text to append to the default system prompt')
        .option('--load-claude-md <sources>', 'Comma-separated list of CLAUDE.md sources')
        .option('--keep-alive-interval <ms>', 'Baileys keepalive IQ ping interval (ms)')
        .option(
            '--send-ready-timeout <ms>',
            'Timeout (ms) waiting for socket to be ready in sendMessage'
        )
        .option('--suppress-startup-announcement', 'Skip the "Now online!" startup announcement')
        .action((options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configDir = parentOpts.directory || process.cwd()
            const configPath = parentOpts.config || getLocalConfigPath(configDir)

            if (existsSync(configPath) && !options.force) {
                console.error(`Config file already exists: ${configPath}`)
                console.error('Use --force to overwrite.')
                process.exit(1)
            }

            // Build config options from CLI flags
            const initOptions: ConfigInitOptions = {
                directory: configDir
            }

            // Whitelist from --whitelist option
            if (options.whitelist) {
                initOptions.whitelist = options.whitelist.split(',').map((s: string) => s.trim())
            }

            // Optional settings from flags
            if (options.mode) {
                initOptions.mode = options.mode
            }
            if (options.session) {
                initOptions.sessionPath = options.session
            }
            if (options.model) {
                initOptions.model = resolveModelShorthand(options.model) || options.model
            }
            if (options.maxTurns) {
                initOptions.maxTurns = parseInt(options.maxTurns, 10)
            }
            if (options.processMissed !== undefined) {
                initOptions.processMissed = options.processMissed
            }
            if (options.missedThreshold) {
                initOptions.missedThresholdMins = parseInt(options.missedThreshold, 10)
            }
            if (options.verbose) {
                initOptions.verbose = options.verbose
            }
            if (options.agentName) {
                initOptions.agentName = options.agentName
            }
            if (options.systemPrompt) {
                initOptions.systemPrompt = options.systemPrompt
            }
            if (options.systemPromptAppend) {
                initOptions.systemPromptAppend = options.systemPromptAppend
            }
            if (options.loadClaudeMd) {
                initOptions.settingSources = options.loadClaudeMd
                    .split(',')
                    .map((s: string) => s.trim())
            }
            if (options.keepAliveInterval) {
                initOptions.keepAliveIntervalMs = parseInt(options.keepAliveInterval, 10)
            }
            if (options.sendReadyTimeout) {
                initOptions.sendReadyTimeoutMs = parseInt(options.sendReadyTimeout, 10)
            }
            if (options.suppressStartupAnnouncement !== undefined) {
                initOptions.suppressStartupAnnouncement = options.suppressStartupAnnouncement
            }

            const template = generateConfigTemplate(initOptions)

            const { writeFileSync, mkdirSync } = require('fs')
            const { dirname } = require('path')
            const dir = dirname(configPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }
            writeFileSync(configPath, template, 'utf-8')

            console.log(`Created config file: ${configPath}`)
        })

    // config path
    config
        .command('path')
        .description('Show config file path')
        .action((_options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configPath = getConfigPath(parentOpts)
            const exists = existsSync(configPath)

            console.log(configPath)
            if (!exists) {
                console.error('(file does not exist)')
            }
        })

    // config import <json>
    config
        .command('import <json>')
        .description('Import configuration from JSON string or file')
        .option('--merge', 'Merge with existing config instead of replacing')
        .action((jsonInput: string, options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configDir = parentOpts.directory || process.cwd()
            const configPath = parentOpts.config || getLocalConfigPath(configDir)

            let newConfig: Partial<Config>

            // Check if input is a file path or JSON string
            if (existsSync(jsonInput)) {
                const { readFileSync } = require('fs')
                const content = readFileSync(jsonInput, 'utf-8')
                newConfig = JSON.parse(content)
            } else {
                try {
                    newConfig = JSON.parse(jsonInput)
                } catch {
                    console.error('Invalid JSON. Provide a valid JSON string or file path.')
                    process.exit(1)
                }
            }

            // Merge if requested
            if (options.merge && existsSync(configPath)) {
                const existingConfig = loadConfigFile(configPath)
                newConfig = { ...existingConfig, ...newConfig }
            }

            // Validate
            const result = ConfigSchema.partial().safeParse(newConfig)
            if (!result.success) {
                console.error('Validation error:')
                for (const issue of result.error.issues) {
                    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
                }
                process.exit(1)
            }

            // Save
            const { writeFileSync, mkdirSync } = require('fs')
            const { dirname } = require('path')
            const dir = dirname(configPath)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }
            writeFileSync(configPath, JSON.stringify(newConfig, null, 4), 'utf-8')

            console.log(`Imported configuration to: ${configPath}`)
        })

    // config export
    config
        .command('export')
        .description('Export configuration as JSON')
        .action((_options, cmd) => {
            const parentOpts = cmd.parent.opts()
            const configPath = getConfigPath(parentOpts)

            if (!existsSync(configPath)) {
                console.error(`No config file found at: ${configPath}`)
                process.exit(1)
            }

            const fileConfig = loadConfigFile(configPath)
            console.log(JSON.stringify(fileConfig, null, 2))
        })

    return config
}
