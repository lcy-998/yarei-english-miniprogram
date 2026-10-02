import { describe, expect, it } from 'vitest';
import { summarizeVocabularyFirstAttempts, vocabularyWordIds } from '../../src/vocabulary-evidence/summary';
import type { VocabularyAttemptRecord } from '../../src/vocabulary-evidence/types';

const first: VocabularyAttemptRecord = { id: 'first', organizationId: 'org_demo', studentId: 'student_demo',
  packId: 'pack_demo', taskId: 'task_demo', itemId: 'item_words', round: 1, contentVersion: '2',
  wordId: 'word_tiger', studentInput: 'lion', isCorrect: false, firstAttempt: true,
  attemptNumber: 1, attemptedAt: '2026-09-16T01:00:00.000Z' };

describe('task vocabulary first-attempt summary', () => {
  it('keeps the first score when the student later corrects a word', () => {
    const words = vocabularyWordIds({ grade: '三年级', unit: 'Unit 3', words: [
      { id: 'word_tiger', word: 'tiger', meaning: '老虎', syllables: ['ti', 'ger'] },
      { id: 'word_lion', word: 'lion', meaning: '狮子', syllables: ['li', 'on'] },
    ] });
    expect(words).toEqual(['word_tiger', 'word_lion']);
    if (words === null) throw new Error('word ids expected');
    expect(summarizeVocabularyFirstAttempts(words, [
      first, { ...first, id: 'second', studentInput: 'tiger', isCorrect: true, firstAttempt: false, attemptNumber: 2 },
      { ...first, id: 'lion', wordId: 'word_lion', studentInput: 'lion', isCorrect: true },
    ])).toEqual({ completedCount: 2, correctCount: 1 });
  });

  it('rejects duplicate, missing-first and out-of-snapshot evidence', () => {
    expect(summarizeVocabularyFirstAttempts(['word_tiger'], [first, first])).toBeNull();
    expect(summarizeVocabularyFirstAttempts(['word_tiger'], [{ ...first, attemptNumber: 2, firstAttempt: false }])).toBeNull();
    expect(summarizeVocabularyFirstAttempts(['word_lion'], [first])).toBeNull();
    expect(vocabularyWordIds({ grade: '三年级', unit: 'Unit 3', words: [
      { id: 'same', word: 'tiger', meaning: '老虎', syllables: ['ti', 'ger'] },
      { id: 'same', word: 'lion', meaning: '狮子', syllables: ['li', 'on'] },
    ] })).toBeNull();
  });
});
