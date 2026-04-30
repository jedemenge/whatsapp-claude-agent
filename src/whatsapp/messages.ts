import type { WAMessage } from '@whiskeysockets/baileys'
import type { IncomingMessage } from '../types.ts'

/**
 * Extract text content from a WhatsApp message
 */
export function extractMessageText(msg: WAMessage): string | null {
    const message = msg.message
    if (!message) return null

    // Direct text message
    if (message.conversation) {
        return message.conversation
    }

    // Extended text message (with link preview, etc.)
    if (message.extendedTextMessage?.text) {
        return message.extendedTextMessage.text
    }

    // Image/video with caption
    if (message.imageMessage?.caption) {
        return message.imageMessage.caption
    }
    if (message.videoMessage?.caption) {
        return message.videoMessage.caption
    }

    // Document with caption
    if (message.documentMessage?.caption) {
        return message.documentMessage.caption
    }

    return null
}

/**
 * Convert Baileys message to our IncomingMessage type
 */
export function parseMessage(msg: WAMessage): IncomingMessage | null {
    const text = extractMessageText(msg)
    if (!text) return null

    const key = msg.key
    if (!key.remoteJid || !key.id) return null

    // Check if this is a group message
    const isGroupMessage = key.remoteJid.endsWith('@g.us')
    const participant = isGroupMessage ? (key.participant ?? undefined) : undefined
    // Baileys v7 surfaces the alternate phone-number JID on remoteJidAlt /
    // participantAlt when delivery is in LID addressing mode. The whitelist
    // matcher uses these as additional candidates so a phone-only whitelist
    // still matches a LID-mode reply.
    const participantAlt = isGroupMessage ? (key.participantAlt ?? undefined) : undefined
    const fromAlt = isGroupMessage ? undefined : (key.remoteJidAlt ?? undefined)
    const rawAddressingMode = key.addressingMode
    const addressingMode: 'pn' | 'lid' | undefined =
        rawAddressingMode === 'pn' || rawAddressingMode === 'lid' ? rawAddressingMode : undefined

    // Pull WhatsApp's own mention list. WhatsApp resolves @-tags to JIDs
    // client-side and ships them in extendedTextMessage.contextInfo, which is
    // the authoritative source for "who was mentioned" — more reliable than
    // re-parsing the text.
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
    const mentions = Array.isArray(mentioned)
        ? mentioned.filter((j): j is string => !!j)
        : undefined

    return {
        id: key.id,
        from: key.remoteJid,
        text: text,
        timestamp: new Date((msg.messageTimestamp as number) * 1000 || Date.now()),
        isFromMe: key.fromMe ?? false,
        participant, // Sender in group (undefined for private)
        isGroupMessage,
        fromAlt,
        participantAlt,
        addressingMode,
        key,
        mentions
    }
}

/**
 * Check if a message is within the threshold time
 */
export function isWithinThreshold(msg: IncomingMessage, thresholdMins: number): boolean {
    const now = Date.now()
    const msgTime = msg.timestamp.getTime()
    const thresholdMs = thresholdMins * 60 * 1000
    return now - msgTime <= thresholdMs
}

/**
 * Check if message is a command (starts with /)
 */
export function isCommand(text: string): boolean {
    return text.trim().startsWith('/')
}

/**
 * Parse a command from message text
 */
export function parseCommand(text: string): { command: string; args: string } | null {
    if (!isCommand(text)) return null

    const trimmed = text.trim()
    const spaceIndex = trimmed.indexOf(' ')

    if (spaceIndex === -1) {
        return { command: trimmed.slice(1).toLowerCase(), args: '' }
    }

    return {
        command: trimmed.slice(1, spaceIndex).toLowerCase(),
        args: trimmed.slice(spaceIndex + 1).trim()
    }
}
