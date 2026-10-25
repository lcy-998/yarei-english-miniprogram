import { describe, expect, it } from 'vitest'
import { needsStructuredSyllables, studentIpaLabel, studentWordLabel, syllableLabel, syllablesAvailable } from '../miniprogram/pages/student/student-syllables'

describe('M3-SYL student display guard', () => {
  it('requires checked syllables for grades three and four', () => {
    expect(needsStructuredSyllables('三年级')).toBe(true)
    expect(needsStructuredSyllables('小学四年级')).toBe(true)
    expect(needsStructuredSyllables('3')).toBe(true)
    expect(needsStructuredSyllables('3-5')).toBe(true)
    expect(needsStructuredSyllables('小学三至五年级')).toBe(true)
    expect(needsStructuredSyllables('2023 届')).toBe(false)
    expect(needsStructuredSyllables('五年级')).toBe(false)
  })

  it('rejects missing or blank syllable parts before practice', () => {
    expect(syllablesAvailable([{ syllables: ['sun', 'shine'] }])).toBe(true)
    expect(syllablesAvailable([{ syllables: [] }])).toBe(false)
    expect(syllablesAvailable([{ syllables: [' '] }])).toBe(false)
    expect(syllablesAvailable([{ syllables: ['sun', ''] }])).toBe(false)
    expect(syllablesAvailable([{ word: 'sunshine', syllables: ['sun', 'shine'],
      syllableDisplay: 'sun-shine' }])).toBe(true)
    expect(syllablesAvailable([{ word: 'sunshine', syllables: ['sun', 'set'] }])).toBe(false)
    expect(syllablesAvailable([{ word: 'sunshine', syllables: ['sun', 'shine'],
      syllableDisplay: 'sunshine' }])).toBe(false)
    expect(syllableLabel({ syllables: [' sun ', 'shine'] })).toBe('sun-shine')
  })

  it('shows a checked IPA label only outside grades three and four', () => {
    expect(studentIpaLabel('五年级', '', '/ˈkəʊələ/')).toBe('/ˈkəʊələ/')
    expect(studentIpaLabel('五年级', '三年级2班', '/ˈkəʊələ/')).toBe('')
    expect(studentIpaLabel('四年级', '', '/ˈkəʊələ/')).toBe('')
    expect(studentIpaLabel('五年级', '', 'koala')).toBe('')
    expect(studentWordLabel({ word: 'koala', syllables: ['ko', 'a', 'la'] }, '五年级', '')).toBe('koala')
    expect(studentWordLabel({ word: 'sunshine', syllables: ['sun', 'shine'] }, '三年级', '')).toBe('sun-shine')
  })
})
