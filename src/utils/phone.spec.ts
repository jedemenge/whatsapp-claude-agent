import { describe, test, expect } from 'bun:test'
import {
    normalizePhone,
    phoneFromJid,
    isWhitelisted,
    isAnyWhitelisted,
    normalizeWhitelistEntry,
    whitelistEntryToSendableJid,
    extractGroupInviteCode,
    stripDeviceSuffix,
    isSelfMention
} from './phone.ts'

describe('phone utils', () => {
    describe('normalizePhone', () => {
        test('removes formatting characters', () => {
            expect(normalizePhone('+1 (234) 567-8901')).toBe('12345678901')
        })

        test('removes leading zeros', () => {
            expect(normalizePhone('001234567890')).toBe('1234567890')
        })
    })

    describe('phoneFromJid', () => {
        test('extracts phone from @s.whatsapp.net JID', () => {
            expect(phoneFromJid('1234567890@s.whatsapp.net')).toBe('1234567890')
        })

        test('extracts ID from @lid JID', () => {
            expect(phoneFromJid('214787086672091@lid')).toBe('214787086672091')
        })

        test('extracts ID from @g.us JID', () => {
            expect(phoneFromJid('123456789-123345@g.us')).toBe('123456789-123345')
        })
    })

    describe('normalizeWhitelistEntry', () => {
        test('normalizes phone number', () => {
            expect(normalizeWhitelistEntry('+1234567890')).toBe('1234567890')
        })

        test('strips @lid suffix', () => {
            expect(normalizeWhitelistEntry('214787086672091@lid')).toBe('214787086672091')
        })

        test('handles lid without suffix', () => {
            expect(normalizeWhitelistEntry('214787086672091')).toBe('214787086672091')
        })

        test('trims whitespace', () => {
            expect(normalizeWhitelistEntry('  214787086672091@lid  ')).toBe('214787086672091')
        })
    })

    describe('isWhitelisted', () => {
        test('matches phone number in whitelist', () => {
            expect(isWhitelisted('1234567890@s.whatsapp.net', ['+1234567890'])).toBe(true)
        })

        test('matches lid in whitelist (without @lid suffix)', () => {
            expect(isWhitelisted('214787086672091@lid', ['214787086672091'])).toBe(true)
        })

        test('matches lid in whitelist (with @lid suffix)', () => {
            expect(isWhitelisted('214787086672091@lid', ['214787086672091@lid'])).toBe(true)
        })

        test('rejects non-whitelisted participant', () => {
            expect(isWhitelisted('999999999@lid', ['214787086672091'])).toBe(false)
        })

        test('handles country code variations', () => {
            // Without country code in whitelist, with in JID
            expect(isWhitelisted('11234567890@s.whatsapp.net', ['1234567890'])).toBe(true)
            // With country code in whitelist, without in JID
            expect(isWhitelisted('1234567890@s.whatsapp.net', ['+11234567890'])).toBe(true)
        })

        test('handles mixed whitelist (phones and lids)', () => {
            const whitelist = ['+1234567890', '214787086672091@lid']
            expect(isWhitelisted('1234567890@s.whatsapp.net', whitelist)).toBe(true)
            expect(isWhitelisted('214787086672091@lid', whitelist)).toBe(true)
            expect(isWhitelisted('999999999@lid', whitelist)).toBe(false)
        })
    })

    describe('isAnyWhitelisted (LID/PN dual identity)', () => {
        test('matches via PN alternate when primary is LID (the reported bug)', () => {
            // Reproduces the original report: phone-only whitelist must accept
            // a reply whose remoteJid is a LID and remoteJidAlt is the PN.
            expect(
                isAnyWhitelisted(
                    ['170025004613669@lid', '31683999861@s.whatsapp.net'],
                    ['+31683999861']
                )
            ).toBe(true)
        })

        test('rejects unknown LID when no alt is present', () => {
            expect(isAnyWhitelisted(['170025004613669@lid', undefined], ['+31683999861'])).toBe(
                false
            )
        })

        test('matches LID-only whitelist via primary candidate', () => {
            expect(
                isAnyWhitelisted(['170025004613669@lid', undefined], ['170025004613669@lid'])
            ).toBe(true)
        })

        test('group analogue: matches via participantAlt', () => {
            expect(
                isAnyWhitelisted(
                    ['214787086672091@lid', '31683999861@s.whatsapp.net'],
                    ['+31683999861']
                )
            ).toBe(true)
        })

        test('skips undefined candidates without throwing', () => {
            expect(isAnyWhitelisted([undefined, undefined], ['+31683999861'])).toBe(false)
        })
    })

    describe('whitelistEntryToSendableJid', () => {
        test('converts a phone number to a PN JID', () => {
            expect(whitelistEntryToSendableJid('+31683999861')).toBe('31683999861@s.whatsapp.net')
        })

        test('returns null for LID-only entries (cannot DM reliably)', () => {
            expect(whitelistEntryToSendableJid('170025004613669@lid')).toBeNull()
        })

        test('passes an already-formed PN JID through unchanged', () => {
            expect(whitelistEntryToSendableJid('1234567890@s.whatsapp.net')).toBe(
                '1234567890@s.whatsapp.net'
            )
        })

        test('passes a group JID through unchanged', () => {
            expect(whitelistEntryToSendableJid('123456789-123345@g.us')).toBe(
                '123456789-123345@g.us'
            )
        })

        test('trims whitespace before routing', () => {
            expect(whitelistEntryToSendableJid('  +31683999861  ')).toBe(
                '31683999861@s.whatsapp.net'
            )
        })
    })

    describe('extractGroupInviteCode', () => {
        test('extracts code from full URL', () => {
            expect(extractGroupInviteCode('https://chat.whatsapp.com/ABC123xyz')).toBe('ABC123xyz')
        })

        test('returns code as-is if not a URL', () => {
            expect(extractGroupInviteCode('ABC123xyz')).toBe('ABC123xyz')
        })

        test('trims whitespace', () => {
            expect(extractGroupInviteCode('  ABC123xyz  ')).toBe('ABC123xyz')
        })
    })

    describe('stripDeviceSuffix', () => {
        test('removes :<device> from PN JID', () => {
            expect(stripDeviceSuffix('31123456789:1@s.whatsapp.net')).toBe(
                '31123456789@s.whatsapp.net'
            )
        })

        test('removes :<device> from LID JID', () => {
            expect(stripDeviceSuffix('170025004613669:5@lid')).toBe('170025004613669@lid')
        })

        test('leaves JID without device suffix unchanged', () => {
            expect(stripDeviceSuffix('31123456789@s.whatsapp.net')).toBe(
                '31123456789@s.whatsapp.net'
            )
        })

        test('handles bare ID with device suffix (no @suffix)', () => {
            expect(stripDeviceSuffix('31123456789:2')).toBe('31123456789')
        })
    })

    describe('isSelfMention', () => {
        const bot = { phone: '31123456789', lid: '170025004613669' }

        test('matches PN-form mention against bot phone', () => {
            expect(isSelfMention('31123456789@s.whatsapp.net', bot)).toBe(true)
        })

        test('matches LID-form mention against bot lid', () => {
            expect(isSelfMention('170025004613669@lid', bot)).toBe(true)
        })

        test('matches mention with device suffix', () => {
            expect(isSelfMention('31123456789:1@s.whatsapp.net', bot)).toBe(true)
            expect(isSelfMention('170025004613669:5@lid', bot)).toBe(true)
        })

        test('rejects unrelated phone', () => {
            expect(isSelfMention('99999999999@s.whatsapp.net', bot)).toBe(false)
        })

        test('rejects unrelated lid', () => {
            expect(isSelfMention('888888888888888@lid', bot)).toBe(false)
        })

        test('returns false when bot identity is empty', () => {
            expect(isSelfMention('31123456789@s.whatsapp.net', {})).toBe(false)
        })

        test('matches when only phone is known', () => {
            expect(isSelfMention('31123456789@s.whatsapp.net', { phone: '31123456789' })).toBe(true)
            expect(isSelfMention('170025004613669@lid', { phone: '31123456789' })).toBe(false)
        })

        test('matches when only lid is known', () => {
            expect(isSelfMention('170025004613669@lid', { lid: '170025004613669' })).toBe(true)
            expect(isSelfMention('31123456789@s.whatsapp.net', { lid: '170025004613669' })).toBe(
                false
            )
        })

        test('does not loose-match by suffix (strict equality)', () => {
            // bot phone "31123456789" should NOT match "123456789" even though
            // it's a suffix — that loose form is intentionally only for whitelist.
            expect(isSelfMention('123456789@s.whatsapp.net', bot)).toBe(false)
        })
    })
})
