import { basename } from 'path'
import { hostname } from 'os'
import { randomSuperhero } from 'superheroes'
import type { AgentIdentity, BotIdentity } from '../types.ts'
import { isSelfMention } from './phone.ts'

/**
 * Get a random superhero name from the superheroes package
 */
export function getRandomSuperheroName(): string {
    return randomSuperhero()
}

/**
 * Convert a string to Title Case
 * Example: "my-project-name" -> "My Project Name"
 * Example: "spider-man" -> "Spider Man"
 */
export function toTitleCase(str: string): string {
    return str
        .replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
        .replace(/\s+/g, ' ') // Normalize multiple spaces
        .trim()
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
}

/**
 * Generate an agent identity with all components
 * @param directory - The working directory
 * @param customName - Optional custom name provided by user
 */
export function generateAgentIdentity(directory: string, customName?: string): AgentIdentity {
    const host = hostname()
    const folder = basename(directory)
    const name = customName || toTitleCase(getRandomSuperheroName())

    return {
        name,
        host,
        folder
    }
}

/**
 * Generate a default agent name based on the hostname, directory name, and a random superhero
 * @deprecated Use generateAgentIdentity instead
 */
export function generateDefaultAgentName(directory: string): string {
    const identity = generateAgentIdentity(directory)
    return `${toTitleCase(identity.host)} ${toTitleCase(identity.folder)} ${identity.name}`
}

/**
 * Validate and normalize an agent name
 * - Trims whitespace
 * - Returns the name if valid, undefined if empty
 */
export function normalizeAgentName(name: string | undefined): string | undefined {
    if (!name) return undefined
    const trimmed = name.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Format a message with the agent identity prefix
 * Format: "[🤖 Name@host folder/]\nmessage"
 */
export function formatMessageWithAgentName(identity: AgentIdentity, message: string): string {
    return `[🤖 ${identity.name}@${identity.host} ${identity.folder}/]\n${message}`
}

/**
 * Get a display string for the agent identity
 * Format: "Name@host folder/"
 */
export function getAgentIdentityDisplay(identity: AgentIdentity): string {
    return `${identity.name}@${identity.host} ${identity.folder}/`
}

/**
 * Result of parsing agent targeting in a message
 */
export interface AgentTargetingResult {
    isTargeted: boolean
    cleanMessage: string
    method?: 'mention' | 'generic' | 'slash'
}

/**
 * Normalize a name for comparison (lowercase, collapse spaces)
 */
function normalizeForMatching(str: string): string {
    return str.toLowerCase().replace(/\s+/g, '').trim()
}

/**
 * Parse a message to check if it targets this agent
 * Supported formats:
 * - @AgentName message (mention by name)
 * - @ai message (generic AI mention)
 * - @agent message (generic agent mention)
 * - @<bot-phone-or-lid> message (mention by bot's own number — detected via
 *   WhatsApp's contextInfo.mentionedJid; requires botIdentity + mentions)
 * - /ask AgentName message (slash command)
 * - /ask message (generic ask)
 *
 * @returns Object with isTargeted, cleanMessage (without prefix), and method
 */
export function parseAgentTargeting(
    text: string,
    agentName: string,
    botIdentity?: BotIdentity,
    mentions?: string[]
): AgentTargetingResult {
    const trimmed = text.trim()
    const normalizedAgentName = normalizeForMatching(agentName)

    // Self-mention via WhatsApp's mentionedJid: if the sender used the @-picker
    // to tag the bot's own number, contextInfo carries the resolved JID. Check
    // before name-matching so a bare `@<bot-number> hi` is recognised even if
    // the agent name happens to overlap.
    if (botIdentity && mentions && mentions.length > 0) {
        const matchesSelf = mentions.some((j) => isSelfMention(j, botIdentity))
        if (matchesSelf) {
            // Strip the leading @<token> from the visible text. WhatsApp puts
            // the @-tag at the front of the message in practice; if it's not
            // there we still fall back to the original text.
            const stripped = trimmed.replace(/^@\S+\s*/, '')
            return { isTargeted: true, cleanMessage: stripped.trim(), method: 'mention' }
        }
    }

    // Check for @mention at start of message
    const mentionMatch = trimmed.match(/^@(\S+)\s*(.*)$/s)
    if (mentionMatch && mentionMatch[1]) {
        const mentionTarget = mentionMatch[1]
        const rest = mentionMatch[2] || ''
        const normalizedTarget = normalizeForMatching(mentionTarget)

        // Check if it's a generic mention (@ai, @agent)
        if (normalizedTarget === 'ai' || normalizedTarget === 'agent') {
            return { isTargeted: true, cleanMessage: rest.trim(), method: 'generic' }
        }

        // Check if it matches the agent name (with or without spaces)
        if (normalizedTarget === normalizedAgentName) {
            return { isTargeted: true, cleanMessage: rest.trim(), method: 'mention' }
        }

        // Check for multi-word agent names: @Spider Man -> try matching progressively
        // e.g., "@Spider Man hello" with agentName "Spider Man"
        const words = trimmed.slice(1).split(/\s+/) // Remove @ and split
        let accumulated = ''
        for (let i = 0; i < words.length; i++) {
            accumulated += (accumulated ? '' : '') + words[i]
            if (normalizeForMatching(accumulated) === normalizedAgentName) {
                const remainingMessage = words.slice(i + 1).join(' ')
                return {
                    isTargeted: true,
                    cleanMessage: remainingMessage.trim(),
                    method: 'mention'
                }
            }
            accumulated += ' '
        }
    }

    // Check for /ask command
    const askMatch = trimmed.match(/^\/ask\s+(.*)$/is)
    if (askMatch && askMatch[1]) {
        const afterAsk = askMatch[1].trim()

        // Check if /ask is followed by agent name
        const words = afterAsk.split(/\s+/)
        let accumulated = ''
        for (let i = 0; i < words.length; i++) {
            accumulated += (accumulated ? ' ' : '') + words[i]
            if (normalizeForMatching(accumulated) === normalizedAgentName) {
                const remainingMessage = words.slice(i + 1).join(' ')
                return { isTargeted: true, cleanMessage: remainingMessage.trim(), method: 'slash' }
            }
        }

        // Generic /ask without specific agent name - target this agent
        return { isTargeted: true, cleanMessage: afterAsk, method: 'slash' }
    }

    return { isTargeted: false, cleanMessage: trimmed }
}
