import { describe, expect, it } from 'vitest';
import { exerciseEvidenceFromSubmission, readingEvidenceFromPageEvents, vocabularyEvidenceFromAttempts, workEvidenceFromStudentWork } from '../../src/activity/activity-evidence';
import type { StudentWork } from '../../src/student-work/types';
import type { VocabularyAttemptRecord } from '../../src/vocabulary-evidence/types';
import type { ReadingPageEventRecord } from '../../src/learning-progress/types';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';

const organizationId = 'org_activity_evidence';
const classId = 'class_activity_evidence';
const studentId = 'student_activity_evidence';
const resourceId = 'question_bird_demo';
const task: TaskRecord = {
  id: 'task_exercise_demo', organizationId, creatorTeacherId: 'teacher_demo', title: '虚构鸟类练习', deliveryType: 'classroom',
  status: 'active', targetType: 'classes', targetClassIds: [classId], targetStudentIds: [],
  startsAt: '2026-09-26T00:00:00.000+08:00', dueAt: '2026-09-27T00:00:00.000+08:00',
  latePolicy: { allowLate: true, lateDays: 7 }, description: null, teacherNote: null, itemRefs: [],
  items: [{ id: 'item_bird', resourceId, resourceVersion: 1, snapshotSchemaVersion: 1,
    resourceSnapshot: { title: '鸟类选择题', type: 'exercise', payload: { questionIds: [resourceId],
      questionType: 'single_choice', stem: 'Which animal can fly?', options: ['bird', 'lion'],
      correctAnswer: 'bird', explanation: 'Birds can fly.' } },
    completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 }, scoringRule: {}, order: 1 }],
  publishedAt: '2026-09-25T00:00:00.000+08:00', deadlineExtendedAt: null, visibility: 'visible',
  withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null, recycledBy: null,
  recycleReason: null, recoverableUntil: null, version: 2,
};
const assignment: TaskAssignmentRecord = { id: 'assignment_bird', organizationId, taskId: task.id, studentId, classId,
  status: 'awaiting_review', latestSubmissionId: 'submission_bird', latestSubmissionVersion: 1,
  redoCount: 0, redoDueAt: null, isLate: false, submittedAt: '2026-09-26T21:15:00+08:00', reviewedAt: null, version: 2 };
const submission: SubmissionRecord = { id: 'submission_bird', organizationId, taskId: task.id,
  assignmentId: assignment.id, studentId, submissionVersion: 1, recordVersion: 1, status: 'submitted',
  answers: [{ itemId: 'item_bird', value: { kind: 'exercise', answeredQuestionCount: 1, correctQuestionCount: 1,
    questionResponses: [{ questionId: resourceId, response: 'bird', isCorrect: true }] } }],
  isLate: false, submittedAt: '2026-09-26T21:15:00+08:00', supersedesSubmissionId: null };
const feedback: ReviewFeedbackRecord = { id: 'feedback_bird', organizationId, taskId: task.id,
  assignmentId: assignment.id, submissionId: submission.id, submissionVersion: 1, teacherId: 'teacher_demo',
  decision: 'approved', score: 90, textComment: '复核完成', returnReason: null,
  publishedAt: '2026-09-27T09:00:00+08:00', source: 'manual' };

function evidence(overrides: Partial<{ task: TaskRecord; assignment: TaskAssignmentRecord; submission: SubmissionRecord;
  feedback: ReviewFeedbackRecord | null; resourceId: string; requiredContentVersion: string;
  studentId: string; classId: string }> = {}) {
  return exerciseEvidenceFromSubmission({ task, assignment, submission, resourceId, studentId, classId, ...overrides });
}

describe('M2 saved exercise evidence for check-in', () => {
  it('recomputes objective correctness and keeps the original submission date after later review', () => {
    expect(evidence()).toEqual({ kind: 'exercise', resourceId, score: 100, submittedAt: submission.submittedAt });
    expect(evidence({ feedback, assignment: { ...assignment, status: 'completed' }, submission: { ...submission, status: 'reviewed' } }))
      .toEqual({ kind: 'exercise', resourceId, score: 90, submittedAt: submission.submittedAt });
  });

  it('does not count drafts, returned work, stale versions, foreign classes or forged correctness', () => {
    expect(evidence({ submission: { ...submission, status: 'draft', submittedAt: null } })).toBeNull();
    expect(evidence({ assignment: { ...assignment, status: 'redo_required' } })).toBeNull();
    expect(evidence({ assignment: { ...assignment, latestSubmissionId: 'submission_other' } })).toBeNull();
    expect(evidence({ assignment: { ...assignment, latestSubmissionVersion: 2 } })).toBeNull();
    expect(evidence({ classId: 'class_other' })).toBeNull();
    expect(evidence({ resourceId: 'question_other' })).toBeNull();
    expect(evidence({ requiredContentVersion: '2' })).toBeNull();
    expect(evidence({ submission: { ...submission, answers: [{ itemId: 'item_bird', value: { kind: 'exercise',
      answeredQuestionCount: 1, correctQuestionCount: 1,
      questionResponses: [{ questionId: resourceId, response: 'lion', isCorrect: true }] } }] } }))
      .toEqual({ kind: 'exercise', resourceId, score: 0, submittedAt: submission.submittedAt });
    expect(evidence({ feedback: { ...feedback, decision: 'returned' } })).toBeNull();
    expect(evidence({ feedback: { ...feedback, organizationId: 'org_other' } })).toBeNull();
  });
});

describe('M2 frozen reading pages for a school-local check-in day', () => {
  const snapshot = { kind: 'reading' as const, resourceId: 'read_zoo_demo', contentVersion: 'demo-v1',
    pageIds: ['page_1', 'page_2'] };
  const event = (pageId: string, visitedAt: string, contentVersion: string | null = 'demo-v1'): ReadingPageEventRecord => ({
    id: `event_${pageId}_${visitedAt}`, organizationId, studentId, resourceId: snapshot.resourceId,
    chapterId: 'chapter_1', pageId, pageNumber: pageId === 'page_1' ? 1 : 2,
    progressVersion: pageId === 'page_1' ? 1 : 2, contentVersion,
    operationId: `operation_${pageId}`, visitedAt,
  });
  const args = { snapshot, organizationId, studentId, date: '2026-09-26', schoolTimeZone: 'Asia/Shanghai' };

  it('requires every frozen page on the same school day and uses the final visit time', () => {
    const page1 = event('page_1', '2026-09-26T08:00:00+08:00');
    const page2 = event('page_2', '2026-09-26T09:00:00+08:00');
    expect(readingEvidenceFromPageEvents({ ...args, events: [page1, page2] }))
      .toEqual({ kind: 'reading', resourceId: snapshot.resourceId, completed: true, submittedAt: page2.visitedAt });
    expect(readingEvidenceFromPageEvents({ ...args, events: [page1, page1] })).toBeNull();
    expect(readingEvidenceFromPageEvents({ ...args, events: [page1, event('page_2', '2026-09-27T00:10:00+08:00')] })).toBeNull();
  });

  it('does not credit newer resource versions, legacy unversioned visits or another student', () => {
    const page1 = event('page_1', '2026-09-26T08:00:00+08:00');
    expect(readingEvidenceFromPageEvents({ ...args, events: [page1, event('page_2', '2026-09-26T09:00:00+08:00', 'demo-v2')] })).toBeNull();
    expect(readingEvidenceFromPageEvents({ ...args, events: [page1, event('page_2', '2026-09-26T09:00:00+08:00', null)] })).toBeNull();
    expect(readingEvidenceFromPageEvents({ ...args, events: [page1, { ...event('page_2', '2026-09-26T09:00:00+08:00'), studentId: 'student_other' }] })).toBeNull();
  });
});

describe('M2 daily word count from immutable first spelling attempts', () => {
  const snapshot = { kind: 'vocabulary' as const, resourceId: 'pack_animals', contentVersion: 'demo-v1',
    wordIds: ['word_tiger', 'word_lion'] };
  const first = (wordId: string, attemptedAt: string): VocabularyAttemptRecord => ({
    id: `${wordId}_${attemptedAt}`, organizationId, studentId, packId: snapshot.resourceId,
    taskId: null, itemId: null, round: 0, contentVersion: 'demo-v1', wordId,
    studentInput: 'wrong', isCorrect: false, firstAttempt: true, attemptNumber: 1, attemptedAt,
  });
  const args = { snapshot, organizationId, studentId, date: '2026-09-27', schoolTimeZone: 'Asia/Shanghai',
    publishedAt: '2026-09-27T08:00:00+08:00', requiredWordCount: 2 };

  it('counts two different words even if the first spelling is wrong, without counting a retry', () => {
    const tiger = first('word_tiger', '2026-09-27T09:00:00+08:00');
    const lion = first('word_lion', '2026-09-27T09:05:00+08:00');
    expect(vocabularyEvidenceFromAttempts({ ...args, attempts: [tiger,
      { ...tiger, id: 'retry', studentInput: 'tiger', isCorrect: true, firstAttempt: false, attemptNumber: 2 }, lion] }))
      .toEqual({ kind: 'vocabulary', resourceId: snapshot.resourceId, completedWordCount: 2,
        submittedAt: lion.attemptedAt });
  });

  it('does not count pre-publication, cross-day, wrong-version or foreign attempts', () => {
    const tiger = first('word_tiger', '2026-09-27T09:00:00+08:00');
    const lion = first('word_lion', '2026-09-27T09:05:00+08:00');
    for (const altered of [
      { ...lion, attemptedAt: '2026-09-27T07:59:00+08:00' },
      { ...lion, attemptedAt: '2026-09-28T00:05:00+08:00' },
      { ...lion, contentVersion: 'demo-v2' },
      { ...lion, studentId: 'student_other' },
      { ...lion, firstAttempt: false, attemptNumber: 2 },
    ]) expect(vocabularyEvidenceFromAttempts({ ...args, attempts: [tiger, altered] })).toBeNull();
  });
});

describe('M2 daily work completion from sealed student submissions', () => {
  const digest = 'a'.repeat(64);
  const work: StudentWork = { id: 'student_work_demo_1', organizationId, studentId, classId,
    materialId: 'material_dubbing', materialVersion: 'demo-v1', stagingPath: 'student-works/staging/demo/work.mp3',
    status: 'submitted', fileId: `cloud://demo/student-works/private/demo/student_work_demo_1/${digest}.mp3`,
    contentSha256: digest, sizeBytes: 1024, durationMs: 12_000, note: '', version: 2,
    createdAt: '2026-09-27T08:00:00+08:00', submittedAt: '2026-09-27T09:00:00+08:00' };
  const args = { snapshot: { kind: 'work' as const, resourceId: work.materialId, contentVersion: 'demo-v1' },
    work, organizationId, studentId, date: '2026-09-27', schoolTimeZone: 'Asia/Shanghai',
    publishedAt: '2026-09-27T08:30:00+08:00' };
  it('counts a submitted private recording only on its school-local submission day', () => {
    expect(workEvidenceFromStudentWork(args)).toEqual({ kind: 'work', resourceId: work.materialId,
      workId: work.id, submittedAt: work.submittedAt });
    expect(workEvidenceFromStudentWork({ ...args, date: '2026-09-28' })).toBeNull();
  });
  it('rejects drafts, another student, changed material versions and unsealed files', () => {
    for (const altered of [
      { ...work, status: 'draft' as const }, { ...work, studentId: 'student_other' },
      { ...work, materialVersion: 'demo-v2' }, { ...work, fileId: 'cloud://demo/public/audio.mp3' },
      { ...work, sizeBytes: 21 * 1024 * 1024 }, { ...work, durationMs: 301_000 },
      { ...work, submittedAt: '2026-09-27T08:00:00+08:00' },
    ]) expect(workEvidenceFromStudentWork({ ...args, work: altered })).toBeNull();
  });
});
