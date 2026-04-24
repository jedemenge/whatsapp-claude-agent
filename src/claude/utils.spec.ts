import { describe, test, expect } from 'bun:test'
import { resolveModelShorthand, getModelShorthand, AVAILABLE_MODELS } from './utils.ts'

describe('resolveModelShorthand', () => {
    describe('simple shorthands (resolve to most recent version)', () => {
        test('opus resolves to most recent opus (4.7)', () => {
            expect(resolveModelShorthand('opus')).toBe('claude-opus-4-7')
        })

        test('sonnet resolves to most recent sonnet (4.6)', () => {
            expect(resolveModelShorthand('sonnet')).toBe('claude-sonnet-4-6')
        })

        test('haiku resolves to most recent haiku (4.5)', () => {
            expect(resolveModelShorthand('haiku')).toBe('claude-haiku-4-5-20251001')
        })
    })

    describe('opus 4.7 variants', () => {
        const expected = 'claude-opus-4-7'

        test('opus-4.7', () => {
            expect(resolveModelShorthand('opus-4.7')).toBe(expected)
        })

        test('opus4.7', () => {
            expect(resolveModelShorthand('opus4.7')).toBe(expected)
        })

        test('opus-4-7', () => {
            expect(resolveModelShorthand('opus-4-7')).toBe(expected)
        })

        test('opus47', () => {
            expect(resolveModelShorthand('opus47')).toBe(expected)
        })
    })

    describe('sonnet 4.6 variants', () => {
        const expected = 'claude-sonnet-4-6'

        test('sonnet-4.6', () => {
            expect(resolveModelShorthand('sonnet-4.6')).toBe(expected)
        })

        test('sonnet4.6', () => {
            expect(resolveModelShorthand('sonnet4.6')).toBe(expected)
        })

        test('sonnet-4-6', () => {
            expect(resolveModelShorthand('sonnet-4-6')).toBe(expected)
        })

        test('sonnet46', () => {
            expect(resolveModelShorthand('sonnet46')).toBe(expected)
        })
    })

    describe('haiku 4.5 variants', () => {
        const expected = 'claude-haiku-4-5-20251001'

        test('haiku-4.5', () => {
            expect(resolveModelShorthand('haiku-4.5')).toBe(expected)
        })

        test('haiku4.5', () => {
            expect(resolveModelShorthand('haiku4.5')).toBe(expected)
        })

        test('haiku-4-5', () => {
            expect(resolveModelShorthand('haiku-4-5')).toBe(expected)
        })

        test('haiku45', () => {
            expect(resolveModelShorthand('haiku45')).toBe(expected)
        })
    })

    describe('opus 4.5 variants', () => {
        const expected = 'claude-opus-4-5-20251101'

        test('opus-4.5', () => {
            expect(resolveModelShorthand('opus-4.5')).toBe(expected)
        })

        test('opus4.5', () => {
            expect(resolveModelShorthand('opus4.5')).toBe(expected)
        })

        test('opus-4-5', () => {
            expect(resolveModelShorthand('opus-4-5')).toBe(expected)
        })

        test('opus45', () => {
            expect(resolveModelShorthand('opus45')).toBe(expected)
        })
    })

    describe('sonnet 4.5 variants', () => {
        const expected = 'claude-sonnet-4-5-20250929'

        test('sonnet-4.5', () => {
            expect(resolveModelShorthand('sonnet-4.5')).toBe(expected)
        })

        test('sonnet4.5', () => {
            expect(resolveModelShorthand('sonnet4.5')).toBe(expected)
        })

        test('sonnet-4-5', () => {
            expect(resolveModelShorthand('sonnet-4-5')).toBe(expected)
        })

        test('sonnet45', () => {
            expect(resolveModelShorthand('sonnet45')).toBe(expected)
        })
    })

    describe('opus 4 variants', () => {
        const expected = 'claude-opus-4-20250514'

        test('opus-4', () => {
            expect(resolveModelShorthand('opus-4')).toBe(expected)
        })

        test('opus4', () => {
            expect(resolveModelShorthand('opus4')).toBe(expected)
        })
    })

    describe('sonnet 4 variants', () => {
        const expected = 'claude-sonnet-4-20250514'

        test('sonnet-4', () => {
            expect(resolveModelShorthand('sonnet-4')).toBe(expected)
        })

        test('sonnet4', () => {
            expect(resolveModelShorthand('sonnet4')).toBe(expected)
        })
    })

    describe('sonnet 3.5 variants', () => {
        const expected = 'claude-3-5-sonnet-20241022'

        test('sonnet-3.5', () => {
            expect(resolveModelShorthand('sonnet-3.5')).toBe(expected)
        })

        test('sonnet3.5', () => {
            expect(resolveModelShorthand('sonnet3.5')).toBe(expected)
        })

        test('sonnet-3-5', () => {
            expect(resolveModelShorthand('sonnet-3-5')).toBe(expected)
        })

        test('sonnet35', () => {
            expect(resolveModelShorthand('sonnet35')).toBe(expected)
        })
    })

    describe('haiku 3.5 variants', () => {
        const expected = 'claude-3-5-haiku-20241022'

        test('haiku-3.5', () => {
            expect(resolveModelShorthand('haiku-3.5')).toBe(expected)
        })

        test('haiku3.5', () => {
            expect(resolveModelShorthand('haiku3.5')).toBe(expected)
        })

        test('haiku-3-5', () => {
            expect(resolveModelShorthand('haiku-3-5')).toBe(expected)
        })

        test('haiku35', () => {
            expect(resolveModelShorthand('haiku35')).toBe(expected)
        })
    })

    describe('opus 3 variants', () => {
        const expected = 'claude-3-opus-20240229'

        test('opus-3', () => {
            expect(resolveModelShorthand('opus-3')).toBe(expected)
        })

        test('opus3', () => {
            expect(resolveModelShorthand('opus3')).toBe(expected)
        })
    })

    describe('haiku 3 variants', () => {
        const expected = 'claude-3-haiku-20240307'

        test('haiku-3', () => {
            expect(resolveModelShorthand('haiku-3')).toBe(expected)
        })

        test('haiku3', () => {
            expect(resolveModelShorthand('haiku3')).toBe(expected)
        })
    })

    describe('case insensitivity', () => {
        test('OPUS resolves correctly', () => {
            expect(resolveModelShorthand('OPUS')).toBe('claude-opus-4-7')
        })

        test('Sonnet resolves correctly', () => {
            expect(resolveModelShorthand('Sonnet')).toBe('claude-sonnet-4-6')
        })

        test('HAIKU-4.5 resolves correctly', () => {
            expect(resolveModelShorthand('HAIKU-4.5')).toBe('claude-haiku-4-5-20251001')
        })

        test('OpUs-4-7 resolves correctly', () => {
            expect(resolveModelShorthand('OpUs-4-7')).toBe('claude-opus-4-7')
        })
    })

    describe('whitespace handling', () => {
        test('leading whitespace is trimmed', () => {
            expect(resolveModelShorthand('  opus')).toBe('claude-opus-4-7')
        })

        test('trailing whitespace is trimmed', () => {
            expect(resolveModelShorthand('opus  ')).toBe('claude-opus-4-7')
        })

        test('surrounding whitespace is trimmed', () => {
            expect(resolveModelShorthand('  sonnet-4  ')).toBe('claude-sonnet-4-20250514')
        })
    })

    describe('full model IDs', () => {
        test('full model ID is returned unchanged', () => {
            expect(resolveModelShorthand('claude-opus-4-7')).toBe('claude-opus-4-7')
        })

        test('all available models are returned unchanged', () => {
            for (const model of AVAILABLE_MODELS) {
                expect(resolveModelShorthand(model)).toBe(model)
            }
        })
    })

    describe('unknown inputs (return undefined)', () => {
        test('unknown shorthand returns undefined', () => {
            expect(resolveModelShorthand('unknown-model')).toBeUndefined()
        })

        test('partial model name returns undefined', () => {
            expect(resolveModelShorthand('claude-opus')).toBeUndefined()
        })

        test('empty string returns undefined', () => {
            expect(resolveModelShorthand('')).toBeUndefined()
        })

        test('typo in shorthand returns undefined', () => {
            expect(resolveModelShorthand('opsu')).toBeUndefined()
        })

        test('invalid version returns undefined', () => {
            expect(resolveModelShorthand('opus-5')).toBeUndefined()
        })
    })
})

describe('AVAILABLE_MODELS', () => {
    test('contains all expected models', () => {
        expect(AVAILABLE_MODELS).toContain('claude-opus-4-7')
        expect(AVAILABLE_MODELS).toContain('claude-sonnet-4-6')
        expect(AVAILABLE_MODELS).toContain('claude-haiku-4-5-20251001')
        expect(AVAILABLE_MODELS).toContain('claude-opus-4-5-20251101')
        expect(AVAILABLE_MODELS).toContain('claude-sonnet-4-5-20250929')
        expect(AVAILABLE_MODELS).toContain('claude-sonnet-4-20250514')
        expect(AVAILABLE_MODELS).toContain('claude-opus-4-20250514')
        expect(AVAILABLE_MODELS).toContain('claude-3-5-sonnet-20241022')
        expect(AVAILABLE_MODELS).toContain('claude-3-5-haiku-20241022')
        expect(AVAILABLE_MODELS).toContain('claude-3-opus-20240229')
        expect(AVAILABLE_MODELS).toContain('claude-3-haiku-20240307')
    })

    test('has expected number of models', () => {
        expect(AVAILABLE_MODELS.length).toBe(11)
    })
})

describe('getModelShorthand', () => {
    test('returns shorthand for opus 4.7', () => {
        expect(getModelShorthand('claude-opus-4-7')).toBe('opus-4-7')
    })

    test('returns shorthand for sonnet 4.6', () => {
        expect(getModelShorthand('claude-sonnet-4-6')).toBe('sonnet-4-6')
    })

    test('returns shorthand for haiku 4.5', () => {
        expect(getModelShorthand('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
    })

    test('returns shorthand for opus 4.5', () => {
        expect(getModelShorthand('claude-opus-4-5-20251101')).toBe('opus-4-5')
    })

    test('returns shorthand for sonnet 4.5', () => {
        expect(getModelShorthand('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5')
    })

    test('returns shorthand for sonnet 4', () => {
        expect(getModelShorthand('claude-sonnet-4-20250514')).toBe('sonnet-4')
    })

    test('returns shorthand for opus 4', () => {
        expect(getModelShorthand('claude-opus-4-20250514')).toBe('opus-4')
    })

    test('returns shorthand for sonnet 3.5', () => {
        expect(getModelShorthand('claude-3-5-sonnet-20241022')).toBe('sonnet-3-5')
    })

    test('returns shorthand for haiku 3.5', () => {
        expect(getModelShorthand('claude-3-5-haiku-20241022')).toBe('haiku-3-5')
    })

    test('returns shorthand for opus 3', () => {
        expect(getModelShorthand('claude-3-opus-20240229')).toBe('opus-3')
    })

    test('returns shorthand for haiku 3', () => {
        expect(getModelShorthand('claude-3-haiku-20240307')).toBe('haiku-3')
    })

    test('returns undefined for unknown model', () => {
        expect(getModelShorthand('unknown-model')).toBeUndefined()
    })

    test('all available models have a shorthand', () => {
        for (const model of AVAILABLE_MODELS) {
            expect(getModelShorthand(model)).toBeDefined()
        }
    })
})
