export function needsStructuredSyllables(grade: string): boolean {
  const normalized = grade.trim()
  return /(?:^|\D)[34](?=\D|$)/.test(normalized)
    || /[三四]年级/.test(normalized)
    || /[三四](?:至|到|—|-|、|及|和)[三四五六]年级/.test(normalized)
}

export function syllablesAvailable(words: readonly Readonly<{ word?: string;
  syllables: readonly string[]; syllableDisplay?: string }>[]): boolean {
  return words.every(word => Array.isArray(word.syllables) && word.syllables.length > 0
    && word.syllables.every(part => typeof part === 'string' && part.trim().length > 0)
    && (!word.word || word.syllables.join('').replace(/[\s-]/g, '').toLowerCase()
      === word.word.replace(/[\s-]/g, '').toLowerCase())
    && (!word.syllableDisplay || word.syllableDisplay.trim() === word.syllables.join('-')))
}

export function syllableLabel(word: Readonly<{ syllables?: readonly string[] }>): string {
  return Array.isArray(word.syllables) ? word.syllables.map(part => part.trim()).join('-') : ''
}

export function studentIpaLabel(packGrade: string, learnerGrade: string, ipa?: string): string {
  if (needsStructuredSyllables(packGrade) || needsStructuredSyllables(learnerGrade)) return ''
  const label = ipa?.trim() ?? ''
  return /^\/[^/]{1,120}\/$/u.test(label) ? label : ''
}

export function studentWordLabel(word: Readonly<{ word: string; syllables: readonly string[] }>,
  packGrade: string, learnerGrade: string): string {
  return needsStructuredSyllables(packGrade) || needsStructuredSyllables(learnerGrade)
    ? syllableLabel(word) : word.word
}
