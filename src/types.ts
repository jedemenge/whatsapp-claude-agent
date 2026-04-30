import { z } from 'zod'
import type {
    PermissionMode as SDKPermissionMode,
    SettingSource as SDKSettingSource
} from '@anthropic-ai/claude-agent-sdk'
import type { WAMessageKey } from '@whiskeysockets/baileys'

// Re-export SDK's PermissionMode type for use throughout the app
export type PermissionMode = SDKPermissionMode

// Re-export SDK's SettingSource type for use throughout the app
export type SettingSource = SDKSettingSource

// Zod schema for runtime validation - aligns with SDK's PermissionMode
export const PermissionModeSchema = z.enum([
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'dontAsk'
])

// Zod schema for runtime validation - aligns with SDK's SettingSource
export const SettingSourceSchema = z.enum(['user', 'project', 'local'])

// Agent identity with separate components for display
export const AgentIdentitySchema = z.object({
    name: z.string(), // The agent's name (superhero name or custom)
    host: z.string(), // Hostname where agent runs
    folder: z.string() // Working directory basename
})

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>

export const ConfigSchema = z.object({
    directory: z.string().default(process.cwd()),
    mode: PermissionModeSchema.default('default'),
    whitelist: z.array(z.string()).min(1, 'At least one whitelisted number required'),
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
    agentName: z.string().optional(), // Custom agent name (if set by user)
    agentIdentity: AgentIdentitySchema, // Full agent identity with components
    joinWhatsAppGroup: z.string().optional(), // Runtime-only: WhatsApp group to join
    allowAllGroupParticipants: z.boolean().default(false), // Runtime-only: bypass whitelist in group mode
    keepAliveIntervalMs: z.number().int().positive().default(15000), // Baileys keepalive IQ ping interval; lower = less chance of 408 timeouts on Bun
    sendReadyTimeoutMs: z.number().int().nonnegative().default(15000), // How long sendMessage() waits for the socket to become ready during a reconnect window
    suppressStartupAnnouncement: z.boolean().default(false), // Skip the "Now online!" announcement even on first ready
    hideAgentPrefix: z.boolean().default(false), // Suppress the "[🤖 Name@host folder/]" prefix on outgoing messages
    ackOnTarget: z.boolean().default(false), // Send a WhatsApp emoji reaction to acknowledge messages targeting this agent (presence signal)
    ackOnTargetEmoji: z.string().default('👀'), // Emoji used when ackOnTarget is enabled
    botNumber: z.string().optional() // Optional override for the bot's own phone number (e.g. "+31123456789"). Auto-derived from sock.user when omitted; used to detect @<bot-number> mentions in groups.
})

export type Config = z.infer<typeof ConfigSchema>

export interface IncomingMessage {
    id: string
    from: string
    text: string
    timestamp: Date
    isFromMe: boolean
    participant?: string // Sender JID in group messages (undefined for private chats)
    isGroupMessage: boolean
    // Baileys v7 dual-identity (LID/PN). When the chat or sender is delivered
    // in LID addressing mode, Baileys puts the alternate phone-number JID on
    // these fields. Whitelist matching considers both the primary and the alt.
    fromAlt?: string
    participantAlt?: string
    addressingMode?: 'pn' | 'lid'
    // Raw Baileys message key, retained so we can post emoji reactions back to
    // the originating message (used by the ackOnTarget presence signal).
    key?: WAMessageKey
    // JIDs the sender @-mentioned, as reported by WhatsApp via
    // contextInfo.mentionedJid. Used to detect mentions of the bot's own
    // phone/LID without parsing them out of the message text.
    mentions?: string[]
}

/**
 * The bot's own WhatsApp identity, resolved at runtime from sock.user (and
 * optionally pinned via config.botNumber). Used to detect self-mentions in
 * groups regardless of whether WhatsApp delivered the mention as PN or LID.
 */
export interface BotIdentity {
    pnJid?: string // e.g. "31123456789@s.whatsapp.net"
    lidJid?: string // e.g. "170025004613669@lid"
    phone?: string // normalized digits of pnJid
    lid?: string // normalized digits of lidJid
}

export interface GroupConfig {
    groupJid: string // The group JID we're listening to
    inviteCode: string // Original invite code (for logging)
}

export interface OutgoingMessage {
    to: string
    text: string
    replyTo?: string
}

export interface PermissionRequest {
    id: string
    toolName: string
    description: string
    input: unknown
    resolve: (allowed: boolean) => void
}

export type AgentEvent =
    | { type: 'qr'; qr: string }
    | { type: 'authenticated' }
    | { type: 'ready' }
    | { type: 'message'; message: IncomingMessage }
    | { type: 'response'; message: OutgoingMessage }
    | { type: 'permission-request'; request: PermissionRequest }
    | { type: 'error'; error: Error }
    | { type: 'disconnected'; reason: string }
