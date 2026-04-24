/**
 * Normalize phone number by removing common prefixes and formatting
 */
export function normalizePhone(phone: string): string {
    return phone.replace(/[\s\-()+ ]/g, '').replace(/^0+/, '')
}

/**
 * Extract phone number or identifier from WhatsApp JID
 * Handles @s.whatsapp.net (phone), @g.us (group), and @lid (privacy ID)
 */
export function phoneFromJid(jid: string): string {
    return jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '')
}

/**
 * Convert phone number to WhatsApp JID
 */
export function phoneToJid(phone: string): string {
    const normalized = normalizePhone(phone)
    return `${normalized}@s.whatsapp.net`
}

/**
 * Normalize a whitelist entry by stripping @lid suffix if present
 * Accepts both "xxx" and "xxx@lid" formats
 */
export function normalizeWhitelistEntry(entry: string): string {
    const trimmed = entry.trim()
    // Strip @lid suffix if present (allows both "xxx" and "xxx@lid" in whitelist)
    if (trimmed.endsWith('@lid')) {
        return normalizePhone(trimmed.slice(0, -4))
    }
    return normalizePhone(trimmed)
}

/**
 * Check if a JID is from a whitelisted number or lid
 * Whitelist accepts: phone numbers (+1234567890), lids (xxx), or lids with suffix (xxx@lid)
 */
export function isWhitelisted(jid: string, whitelist: string[]): boolean {
    const phone = phoneFromJid(jid)
    const normalizedPhone = normalizePhone(phone)

    return whitelist.some((allowed) => {
        const normalizedAllowed = normalizeWhitelistEntry(allowed)
        // Match if either ends with the other (handles country code variations)
        return (
            normalizedPhone.endsWith(normalizedAllowed) ||
            normalizedAllowed.endsWith(normalizedPhone) ||
            normalizedPhone === normalizedAllowed
        )
    })
}

/**
 * Match the whitelist against any of the supplied sender candidates.
 * Used to honour Baileys v7 dual-identity (LID/PN), where a single sender
 * may surface under multiple JIDs in the same message key.
 */
export function isAnyWhitelisted(
    candidates: Array<string | undefined>,
    whitelist: string[]
): boolean {
    return candidates.some((c) => c !== undefined && isWhitelisted(c, whitelist))
}

/**
 * Convert a whitelist entry to a JID we can send to. Returns null for
 * LID-only entries (we cannot reliably DM a contact from their LID alone:
 * such sends produce malformed JIDs and trigger announcement loops when
 * the echo round-trips through the alternate identity).
 */
export function whitelistEntryToSendableJid(entry: string): string | null {
    const trimmed = entry.trim()
    if (trimmed.endsWith('@s.whatsapp.net') || trimmed.endsWith('@g.us')) {
        return trimmed
    }
    if (trimmed.endsWith('@lid')) {
        return null
    }
    return phoneToJid(trimmed)
}

/**
 * Check if JID is a group chat
 */
export function isGroupJid(jid: string): boolean {
    return jid.endsWith('@g.us')
}

/**
 * Extract invite code from WhatsApp group URL or return code as-is
 * @param urlOrCode - Full URL (https://chat.whatsapp.com/XXX) or just code (XXX)
 * @returns Invite code
 */
export function extractGroupInviteCode(urlOrCode: string): string {
    const trimmed = urlOrCode.trim()

    // Check if it's a URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const url = new URL(trimmed)
            // Extract path after /
            const parts = url.pathname.split('/')
            return parts[parts.length - 1] || trimmed
        } catch {
            // If URL parsing fails, return as-is
            return trimmed
        }
    }

    // Already a code
    return trimmed
}
