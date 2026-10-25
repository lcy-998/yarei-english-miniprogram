import { describe, expect, it } from 'vitest';
import { validExerciseSections } from '../../src/task-core/exercise-section-guard';

const question = (sectionId: string, order: number, questionOrder: number, material = 'Read the whole passage.') => ({
  type: 'exercise', payload: { questionIds: [`${sectionId}_${questionOrder}`], questionType: 'single_choice',
    stem: 'What happened?', options: ['A', 'B', 'C'], correctAnswer: 'B', explanation: 'The passage says B.',
    assetLibrary: { exercisePackId: 'pack_1' }, exerciseSection: { id: sectionId,
      title: `Section ${order}`, instruction: 'Read and answer.', studentMaterial: material,
      order, questionOrder, points: 2 } },
});

describe('hierarchical exercise publish guard', () => {
  const complete = [question('s1', 1, 1), question('s1', 1, 2),
    question('s2', 2, 1), question('s2', 2, 2), question('s2', 2, 3)];

  it('accepts two complete big questions with ordered small questions', () => {
    expect(validExerciseSections(complete)).toBe(true);
  });

  it('rejects a missing small question and inconsistent shared material', () => {
    expect(validExerciseSections(complete.slice(1))).toBe(false);
    expect(validExerciseSections([...complete.slice(0, 4), question('s2', 2, 3, 'Different passage')]))
      .toBe(false);
  });

  it('keeps historical flat packs readable', () => {
    expect(validExerciseSections(complete.map(row => ({ ...row,
      payload: { ...row.payload, exerciseSection: undefined } })))).toBe(true);
  });
});
