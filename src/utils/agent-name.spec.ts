import { describe, test, expect } from 'bun:test'
import { hostname } from 'os'
import superheroes from 'superheroes'
import {
    getRandomSuperheroName,
    toTitleCase,
    generateDefaultAgentName,
    normalizeAgentName,
    formatMessageWithAgentName,
    parseAgentTargeting
} from './agent-name.ts'

describe('getRandomSuperheroName', () => {
    test('returns a string', () => {
        const name = getRandomSuperheroName()
        expect(typeof name).toBe('string')
    })

    test('returns a non-empty string', () => {
        const name = getRandomSuperheroName()
        expect(name.length).toBeGreaterThan(0)
    })

    test('returns a name from the superheroes list', () => {
        const name = getRandomSuperheroName()
        expect(superheroes).toContain(name)
    })

    test('returns different names on multiple calls (statistical test)', () => {
        // Call 10 times and check that we don't always get the same name
        const names = new Set<string>()
        for (let i = 0; i < 10; i++) {
            names.add(getRandomSuperheroName())
        }
        // With 700+ heroes, getting the same name 10 times in a row is extremely unlikely
        expect(names.size).toBeGreaterThan(1)
    })
})

describe('toTitleCase', () => {
    test('converts lowercase to title case', () => {
        expect(toTitleCase('hello world')).toBe('Hello World')
    })

    test('converts uppercase to title case', () => {
        expect(toTitleCase('HELLO WORLD')).toBe('Hello World')
    })

    test('converts mixed case to title case', () => {
        expect(toTitleCase('hElLo WoRlD')).toBe('Hello World')
    })

    test('replaces dashes with spaces', () => {
        expect(toTitleCase('spider-man')).toBe('Spider Man')
        expect(toTitleCase('my-project-name')).toBe('My Project Name')
    })

    test('replaces underscores with spaces', () => {
        expect(toTitleCase('my_project_name')).toBe('My Project Name')
    })

    test('normalizes multiple spaces', () => {
        expect(toTitleCase('hello   world')).toBe('Hello World')
    })

    test('trims whitespace', () => {
        expect(toTitleCase('  hello world  ')).toBe('Hello World')
    })

    test('handles empty string', () => {
        expect(toTitleCase('')).toBe('')
    })

    test('handles single word', () => {
        expect(toTitleCase('batman')).toBe('Batman')
    })

    test('handles numbers in names', () => {
        expect(toTitleCase('3-d-man')).toBe('3 D Man')
    })
})

describe('generateDefaultAgentName', () => {
    const titleCaseHostname = toTitleCase(hostname())

    test('starts with hostname in Title Case', () => {
        const name = generateDefaultAgentName('/home/user/my-project')
        expect(name).toMatch(new RegExp(`^${titleCaseHostname} `))
    })

    test('includes directory basename in Title Case after hostname', () => {
        const name = generateDefaultAgentName('/home/user/my-project')
        expect(name).toMatch(new RegExp(`^${titleCaseHostname} My Project `))
    })

    test('handles nested directory paths', () => {
        const name = generateDefaultAgentName('/very/deep/nested/path/to/project-name')
        expect(name).toMatch(new RegExp(`^${titleCaseHostname} Project Name `))
    })

    test('converts directory name to Title Case', () => {
        const name = generateDefaultAgentName('/home/user/knowii-voice-ai')
        expect(name).toMatch(new RegExp(`^${titleCaseHostname} Knowii Voice Ai `))
    })

    test('appends a superhero name in Title Case', () => {
        const name = generateDefaultAgentName('/home/user/test')
        // Should have format: "{Hostname} Test {Superhero Name}"
        const parts = name.split(' ')
        expect(parts.length).toBeGreaterThanOrEqual(3)
        // All words should be title cased (first letter uppercase)
        for (const part of parts) {
            expect(part.charAt(0)).toBe(part.charAt(0).toUpperCase())
        }
    })

    test('generates different names on multiple calls', () => {
        const names = new Set<string>()
        for (let i = 0; i < 10; i++) {
            names.add(generateDefaultAgentName('/home/user/project'))
        }
        // Should get some variety in the generated names
        expect(names.size).toBeGreaterThan(1)
    })
})

describe('normalizeAgentName', () => {
    test('returns undefined for undefined input', () => {
        expect(normalizeAgentName(undefined)).toBeUndefined()
    })

    test('returns undefined for empty string', () => {
        expect(normalizeAgentName('')).toBeUndefined()
    })

    test('returns undefined for whitespace-only string', () => {
        expect(normalizeAgentName('   ')).toBeUndefined()
        expect(normalizeAgentName('\t\n')).toBeUndefined()
    })

    test('trims whitespace from valid names', () => {
        expect(normalizeAgentName('  My Agent  ')).toBe('My Agent')
        expect(normalizeAgentName('\tMy Agent\n')).toBe('My Agent')
    })

    test('returns valid names unchanged (after trim)', () => {
        expect(normalizeAgentName('My Agent')).toBe('My Agent')
        expect(normalizeAgentName('Knowii Voice AI Jarvis')).toBe('Knowii Voice AI Jarvis')
    })
})

describe('formatMessageWithAgentName', () => {
    const identity = { name: 'Spider Man', host: 'mypc', folder: 'my-project' }

    test('formats message with robot emoji and agent identity prefix followed by newline', () => {
        const result = formatMessageWithAgentName(identity, 'Hello world')
        expect(result).toBe('[🤖 Spider Man@mypc my-project/]\nHello world')
    })

    test('handles empty message', () => {
        const result = formatMessageWithAgentName(identity, '')
        expect(result).toBe('[🤖 Spider Man@mypc my-project/]\n')
    })

    test('handles multiline messages', () => {
        const result = formatMessageWithAgentName(identity, 'Line 1\nLine 2\nLine 3')
        expect(result).toBe('[🤖 Spider Man@mypc my-project/]\nLine 1\nLine 2\nLine 3')
    })

    test('handles messages with special characters', () => {
        const result = formatMessageWithAgentName(
            { name: 'Bot', host: 'server', folder: 'app' },
            'Code: `console.log()`'
        )
        expect(result).toBe('[🤖 Bot@server app/]\nCode: `console.log()`')
    })

    test('handles agent names with spaces', () => {
        const result = formatMessageWithAgentName(
            { name: 'Spider Man', host: 'server01', folder: 'myapp' },
            'Hi!'
        )
        expect(result).toBe('[🤖 Spider Man@server01 myapp/]\nHi!')
    })
})

describe('parseAgentTargeting', () => {
    describe('@mention targeting', () => {
        test('detects @AgentName (exact match)', () => {
            const result = parseAgentTargeting('@SpiderMan hello world', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('hello world')
            expect(result.method).toBe('mention')
        })

        test('detects @AgentName case-insensitive', () => {
            const result = parseAgentTargeting('@spiderman hello', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('hello')
            expect(result.method).toBe('mention')
        })

        test('detects @Agent Name with spaces in agent name', () => {
            const result = parseAgentTargeting('@Spider Man hello world', 'Spider Man')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('hello world')
            expect(result.method).toBe('mention')
        })

        test('does not match wrong agent name', () => {
            const result = parseAgentTargeting('@Batman hello', 'SpiderMan')
            expect(result.isTargeted).toBe(false)
        })
    })

    describe('@ai and @agent generic targeting', () => {
        test('detects @ai', () => {
            const result = parseAgentTargeting('@ai what is 2+2?', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('what is 2+2?')
            expect(result.method).toBe('generic')
        })

        test('detects @AI (case-insensitive)', () => {
            const result = parseAgentTargeting('@AI help me', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('help me')
            expect(result.method).toBe('generic')
        })

        test('detects @agent', () => {
            const result = parseAgentTargeting('@agent do something', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('do something')
            expect(result.method).toBe('generic')
        })

        test('detects @AGENT (case-insensitive)', () => {
            const result = parseAgentTargeting('@AGENT help', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('help')
            expect(result.method).toBe('generic')
        })
    })

    describe('/ask command targeting', () => {
        test('detects /ask with message', () => {
            const result = parseAgentTargeting('/ask what time is it?', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('what time is it?')
            expect(result.method).toBe('slash')
        })

        test('detects /ask AgentName with message', () => {
            const result = parseAgentTargeting('/ask SpiderMan hello there', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('hello there')
            expect(result.method).toBe('slash')
        })

        test('detects /ask Agent Name (with spaces) with message', () => {
            const result = parseAgentTargeting('/ask Spider Man what is up?', 'Spider Man')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('what is up?')
            expect(result.method).toBe('slash')
        })

        test('detects /ASK (case-insensitive)', () => {
            const result = parseAgentTargeting('/ASK help me', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('help me')
            expect(result.method).toBe('slash')
        })
    })

    describe('non-targeted messages', () => {
        test('returns not targeted for plain messages', () => {
            const result = parseAgentTargeting('hello world', 'SpiderMan')
            expect(result.isTargeted).toBe(false)
            expect(result.cleanMessage).toBe('hello world')
        })

        test('returns not targeted for wrong @mention', () => {
            const result = parseAgentTargeting('@someone else', 'SpiderMan')
            expect(result.isTargeted).toBe(false)
        })

        test('returns not targeted for @ in middle of message', () => {
            const result = parseAgentTargeting('email me at test@example.com', 'SpiderMan')
            expect(result.isTargeted).toBe(false)
        })
    })

    describe('edge cases', () => {
        test('handles empty message after targeting', () => {
            const result = parseAgentTargeting('@SpiderMan', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('')
        })

        test('handles whitespace-only message after targeting', () => {
            const result = parseAgentTargeting('@SpiderMan   ', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('')
        })

        test('preserves multiline messages', () => {
            const result = parseAgentTargeting('@ai line1\nline2\nline3', 'SpiderMan')
            expect(result.isTargeted).toBe(true)
            expect(result.cleanMessage).toBe('line1\nline2\nline3')
        })
    })

    describe('self-mention via mentionedJid', () => {
        const bot = { phone: '31123456789', lid: '170025004613669' }

        test('matches @<bot-phone> when mentions array contains PN JID', () => {
            const r = parseAgentTargeting('@31123456789 werkt dit ook?', 'SpiderMan', bot, [
                '31123456789@s.whatsapp.net'
            ])
            expect(r.isTargeted).toBe(true)
            expect(r.cleanMessage).toBe('werkt dit ook?')
            expect(r.method).toBe('mention')
        })

        test('matches @<bot-lid> when mentions array contains LID JID', () => {
            const r = parseAgentTargeting('@170025004613669 hoi', 'SpiderMan', bot, [
                '170025004613669@lid'
            ])
            expect(r.isTargeted).toBe(true)
            expect(r.cleanMessage).toBe('hoi')
            expect(r.method).toBe('mention')
        })

        test('matches when mention has device suffix', () => {
            const r = parseAgentTargeting('@31123456789 hi', 'SpiderMan', bot, [
                '31123456789:1@s.whatsapp.net'
            ])
            expect(r.isTargeted).toBe(true)
            expect(r.method).toBe('mention')
        })

        test('not targeted when mentioned JID is someone else', () => {
            const r = parseAgentTargeting('@99999999999 hi', 'SpiderMan', bot, [
                '99999999999@s.whatsapp.net'
            ])
            expect(r.isTargeted).toBe(false)
        })

        test('not targeted when mentions array is empty', () => {
            const r = parseAgentTargeting('@31123456789 hi', 'SpiderMan', bot, [])
            expect(r.isTargeted).toBe(false)
        })

        test('not targeted without botIdentity even if mentions are present', () => {
            const r = parseAgentTargeting('@31123456789 hi', 'SpiderMan', undefined, [
                '31123456789@s.whatsapp.net'
            ])
            expect(r.isTargeted).toBe(false)
        })

        test('falls through to name match when self-mention does not apply', () => {
            const r = parseAgentTargeting('@SpiderMan hi', 'SpiderMan', bot, [])
            expect(r.isTargeted).toBe(true)
            expect(r.method).toBe('mention')
            expect(r.cleanMessage).toBe('hi')
        })
    })
})
