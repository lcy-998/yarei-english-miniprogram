import { describe, expect, it } from 'vitest';
import { automaticTaskScore, manualTaskItemIds, scoreTaskWithManualItems, taskScoringItems } from '../../src/task-core/task-score';
import type { SubmissionRecord, TaskRecord } from '../../src/task-core/types';

const task: TaskRecord = {
  id: 'task_mixed_demo', organizationId: 'org_demo', creatorTeacherId: 'teacher_demo', title: '虚构阅读与录音',
  deliveryType: 'classroom', status: 'active', targetType: 'classes', targetClassIds: ['class_demo'],
  targetStudentIds: [], startsAt: '2026-09-27T08:00:00+08:00', dueAt: '2026-09-28T08:00:00+08:00',
  latePolicy: { allowLate: true, lateDays: 7 }, description: '', teacherNote: null, itemRefs: [],
  items: [{ id: 'read', resourceId: 'book_demo', resourceVersion: 1, snapshotSchemaVersion: 1,
    resourceSnapshot: { title: '虚构绘本', type: 'reading', payload: {} },
    completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
    scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 },
  { id: 'record', resourceId: 'prompt_demo', resourceVersion: 1, snapshotSchemaVersion: 1,
    resourceSnapshot: { title: '虚构朗读', type: 'recording', payload: { prompt: 'Read a sentence.' } },
    completionRule: { kind: 'recording_upload' }, scoringRule: { kind: 'manual', maxScore: 100 }, order: 2 }],
  publishedAt: '2026-09-27T08:00:00+08:00', deadlineExtendedAt: null, visibility: 'visible',
  withdrawnAt: null, withdrawnBy: null, withdrawReason: null, recycledAt: null, recycledBy: null,
  recycleReason: null, recoverableUntil: null, version: 2,
};
const submission: SubmissionRecord = { id: 'submission_demo', organizationId: task.organizationId,
  taskId: task.id, assignmentId: 'assignment_demo', studentId: 'student_demo', submissionVersion: 1,
  recordVersion: 1, status: 'submitted', answers: [
    { itemId: 'read', value: { kind: 'reading', completedPageCount: 1 } },
    { itemId: 'record', value: { kind: 'recording', recordingId: 'recording_demo', durationMs: 5000, sizeBytes: 1000 } },
  ], isLate: false, submittedAt: '2026-09-27T09:00:00+08:00', supersedesSubmissionId: null };

describe('M2 weighted teacher scoring for mixed content', () => {
  it('scores manual recording alongside automatic reading using the published weights', () => {
    expect(automaticTaskScore(task, submission)).toBeNull();
    expect(manualTaskItemIds(task, submission)).toEqual(['record']);
    expect(scoreTaskWithManualItems(task, submission, [{ itemId: 'record', score: 60 }])).toBe(80);
    const weighted: TaskRecord = { ...task, items: task.items.map((item, index) => ({ ...item,
      scoringRule: { ...item.scoringRule, weightPercent: index === 0 ? 25 : 75 } })) };
    expect(scoreTaskWithManualItems(weighted, submission, [{ itemId: 'record', score: 60 }])).toBe(70);
    expect(taskScoringItems(weighted, submission)).toEqual([
      { itemId: 'read', weightPercent: 25, automaticScore: 100, teacherScoreRequired: false, complete: true },
      { itemId: 'record', weightPercent: 75, automaticScore: null, teacherScoreRequired: true, complete: true },
    ]);
  });

  it('rejects missing, extra and invalid manual item scores', () => {
    expect(scoreTaskWithManualItems(task, submission, [])).toBeNull();
    expect(scoreTaskWithManualItems(task, submission, [{ itemId: 'read', score: 80 }])).toBeNull();
    expect(scoreTaskWithManualItems(task, submission, [{ itemId: 'record', score: 101 }])).toBeNull();
    expect(scoreTaskWithManualItems(task, { ...submission, answers: submission.answers.slice(0, 1) },
      [{ itemId: 'record', score: 60 }])).toBeNull();
  });
});
