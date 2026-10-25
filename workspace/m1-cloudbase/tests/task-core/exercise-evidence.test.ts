import { describe, expect, it } from 'vitest';
import { evaluateExerciseSubmission, readExerciseQuestionSnapshot } from '../../src/task-core/exercise-evidence';

describe('M2 exercise evidence from a published snapshot', () => {
  const payload = {
    questionIds: ['q_demo_01'], questionType: 'single_choice', stem: 'Which animal can fly?',
    options: ['A. bird', 'B. lion'], correctAnswer: 'A. bird', explanation: 'Birds can fly.',
  };

  it('grades the actual response on the server and persists a canonical per-question record', () => {
    const snapshot = readExerciseQuestionSnapshot(payload);
    if (!snapshot) throw new Error('fixture invalid');
    expect(evaluateExerciseSubmission(snapshot, { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: 'A. bird' }] }))
      .toEqual({ complete: true, automaticScore: 100, canonicalValue: {
        kind: 'exercise', answeredQuestionCount: 1, correctQuestionCount: 1,
        questionResponses: [{ questionId: 'q_demo_01', response: 'A. bird', isCorrect: true }],
      } });
    expect(evaluateExerciseSubmission(snapshot, { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: 'B. lion' }] }))
      .toMatchObject({ complete: true, automaticScore: 0, canonicalValue: { correctQuestionCount: 0 } });
  });

  it('rejects forged correctness, foreign IDs, missing and outside-option answers', () => {
    const snapshot = readExerciseQuestionSnapshot(payload);
    if (!snapshot) throw new Error('fixture invalid');
    for (const value of [
      { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: 'A. bird', isCorrect: true }] },
      { kind: 'exercise', questionResponses: [{ questionId: 'q_other', response: 'A. bird' }] },
      { kind: 'exercise', questionResponses: [] },
      { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: 'C. fox' }] },
      { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: 'A. bird' }], correctQuestionCount: 1 },
    ]) expect(evaluateExerciseSubmission(snapshot, value).complete).toBe(false);
  });

  it('scores multiple choice as a set and leaves subjective work for teacher grading', () => {
    const multiple = readExerciseQuestionSnapshot({ ...payload, questionType: 'multiple_choice',
      options: ['A', 'B', 'C'], correctAnswer: ['A', 'C'] });
    if (!multiple) throw new Error('multiple fixture invalid');
    expect(evaluateExerciseSubmission(multiple, { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: ['C', 'A'] }] }).automaticScore).toBe(100);
    expect(evaluateExerciseSubmission(multiple, { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: ['A', 'A'] }] }).complete).toBe(false);
    const subjective = readExerciseQuestionSnapshot({ ...payload, questionType: 'subjective', options: [], correctAnswer: '参考答案' });
    if (!subjective) throw new Error('subjective fixture invalid');
    expect(evaluateExerciseSubmission(subjective, { kind: 'exercise', questionResponses: [{ questionId: 'q_demo_01', response: '学生的原创回答' }] }))
      .toMatchObject({ complete: true, automaticScore: null, canonicalValue: { answeredQuestionCount: 1 } });
  });

  it('rejects incomplete or inconsistent publish snapshots', () => {
    expect(readExerciseQuestionSnapshot({ ...payload, questionIds: ['q_demo_01', 'q_demo_02'] })).toBeNull();
    expect(readExerciseQuestionSnapshot({ ...payload, correctAnswer: 'C. fox' })).toBeNull();
  });

  it('freezes a valid big-question section and rejects malformed section metadata', () => {
    const section = { id: 'reading', title: '大题二：阅读', instruction: '读短文',
      studentMaterial: 'A complete passage.', order: 2, questionOrder: 1, points: 2 };
    expect(readExerciseQuestionSnapshot({ ...payload, exerciseSection: section })?.exerciseSection)
      .toEqual(section);
    expect(readExerciseQuestionSnapshot({ ...payload,
      exerciseSection: { ...section, studentMaterial: 123 } })).toBeNull();
  });

  it('accepts reviewed fill variants and preserves a subjective scoring rubric', () => {
    const fill = readExerciseQuestionSnapshot({ ...payload, questionType: 'fill', options: [],
      correctAnswer: 'two', acceptedAnswers: ['two', '2'] });
    if (!fill) throw new Error('fill fixture invalid');
    expect(evaluateExerciseSubmission(fill, { kind: 'exercise',
      questionResponses: [{ questionId: 'q_demo_01', response: '2' }] }).automaticScore).toBe(100);
    const section = { id: 'writing', title: '大题二：表达', instruction: '写句子',
      studentMaterial: '', order: 2, questionOrder: 1, points: 4 };
    const rubric = [{ criterion: '内容准确', points: 2 }, { criterion: '表达清楚', points: 2 }];
    expect(readExerciseQuestionSnapshot({ ...payload, questionType: 'subjective', options: [],
      correctAnswer: 'Reference only', exerciseSection: section, rubric })?.rubric).toEqual(rubric);
    expect(readExerciseQuestionSnapshot({ ...payload, questionType: 'subjective', options: [],
      correctAnswer: 'Reference only', exerciseSection: section,
      rubric: [{ criterion: '内容准确', points: 2 }] })).toBeNull();
  });
});
