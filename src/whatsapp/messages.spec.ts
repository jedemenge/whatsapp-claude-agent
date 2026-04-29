import { describe, test, expect } from 'bun:test'
import type { WAMessage } from '@whiskeysockets/baileys'
import { parseMessage } from './messages.ts'

function makeMessage(key: WAMessage['key'], text = 'hi'): WAMessage {
    return {
        key,
        message: { conversation: text },
        messageTimestamp: 1700000000
    } as unknown as WAMessage
}

describe('parseMessage', () => {
    test('passes Baileys LID/PN dual-identity fields through for DMs', () => {
        const parsed = parseMessage(
            makeMessage({
                id: 'ABC',
                remoteJid: '170025004613669@lid',
                remoteJidAlt: '31683999861@s.whatsapp.net',
                addressingMode: 'lid',
                fromMe: false
            })
        )
        expect(parsed).not.toBeNull()
        expect(parsed!.from).toBe('170025004613669@lid')
        expect(parsed!.fromAlt).toBe('31683999861@s.whatsapp.net')
        expect(parsed!.addressingMode).toBe('lid')
        expect(parsed!.isGroupMessage).toBe(false)
        expect(parsed!.participant).toBeUndefined()
        expect(parsed!.participantAlt).toBeUndefined()
    })

    test('passes participantAlt through for group messages', () => {
        const parsed = parseMessage(
            makeMessage({
                id: 'DEF',
                remoteJid: '123456789-123345@g.us',
                participant: '214787086672091@lid',
                participantAlt: '31683999861@s.whatsapp.net',
                addressingMode: 'lid',
                fromMe: false
            })
        )
        expect(parsed).not.toBeNull()
        expect(parsed!.isGroupMessage).toBe(true)
        expect(parsed!.participant).toBe('214787086672091@lid')
        expect(parsed!.participantAlt).toBe('31683999861@s.whatsapp.net')
        expect(parsed!.fromAlt).toBeUndefined() // alt is per-side, not duplicated
    })

    test('leaves alt fields undefined when Baileys does not provide them', () => {
        const parsed = parseMessage(
            makeMessage({
                id: 'GHI',
                remoteJid: '31683999861@s.whatsapp.net',
                fromMe: false
            })
        )
        expect(parsed).not.toBeNull()
        expect(parsed!.fromAlt).toBeUndefined()
        expect(parsed!.participantAlt).toBeUndefined()
        expect(parsed!.addressingMode).toBeUndefined()
    })

    test('ignores unrecognised addressingMode values', () => {
        const parsed = parseMessage(
            makeMessage({
                id: 'JKL',
                remoteJid: '31683999861@s.whatsapp.net',
                addressingMode: 'something-unexpected',
                fromMe: false
            })
        )
        expect(parsed).not.toBeNull()
        expect(parsed!.addressingMode).toBeUndefined()
    })

    test('exposes the raw Baileys key so reactions can target it', () => {
        const key = {
            id: 'RXN',
            remoteJid: '31683999861@s.whatsapp.net',
            fromMe: false
        }
        const parsed = parseMessage(makeMessage(key))
        expect(parsed).not.toBeNull()
        expect(parsed!.key).toBe(key)
    })
})
