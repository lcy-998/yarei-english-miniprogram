import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { InMemoryIdentityRepository, type AuthorizationFixture } from '../../src/runtime/memory-ports';
import type { ParentStudentLinkRecord } from '../../src/runtime/records';
import type { ReviewFeedbackRecord, SubmissionRecord, TaskAssignmentRecord, TaskRecord } from '../../src/task-core/types';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { ParentTaskQueryService } from '../../src/task-query/parent-service';
import { parentSafeAnswers } from '../../src/task-query/parent-answer-projection';
import { validateParentQueryRequest } from '../../src/contracts/task-core-functions';

const ORGANIZATION_ID = 'org_demo';
const PARENT_ID = 'parent_demo';
const CHILD_ID = 'student_demo';

const parent: TrustedActorContext = {
  requestId: 'request_parent', sessionId: 'session_parent', actorUserId: PARENT_ID, actorRole: 'parent',
  organizationId: ORGANIZATION_ID, platformSubjectDigest: 'digest_parent', permissions: ['child.read'],
  scopeIds: [], authzVersion: 2,
};

function task(): TaskRecord {
  return {
    id: 'task_demo', organizationId: ORGANIZATION_ID, creatorTeacherId: 'teacher_demo', title: '虚构阅读任务',
    deliveryType: 'classroom', status: 'active', targetType: 'students', targetClassIds: ['class_demo'], targetStudentIds: [CHILD_ID],
    startsAt: '2026-09-15T00:00:00.000Z', dueAt: '2026-09-18T00:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
    description: '学生可见说明', teacherNote: '家长不可见备注', itemRefs: [], items: [], publishedAt: '2026-09-15T00:00:00.000Z',
    deadlineExtendedAt: null, visibility: 'visible', withdrawnAt: null, withdrawnBy: null, withdrawReason: null,
    recycledAt: null, recycledBy: null, recycleReason: null, recoverableUntil: null, version: 2,
  };
}

function assignment(): TaskAssignmentRecord {
  return {
    id: 'assignment_demo', organizationId: ORGANIZATION_ID, taskId: 'task_demo', studentId: CHILD_ID, classId: 'class_demo',
    status: 'completed', latestSubmissionId: 'submission_demo', latestSubmissionVersion: 1, redoCount: 0, redoDueAt: null,
    isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', reviewedAt: '2026-09-16T02:00:00.000Z', version: 3,
  };
}

function submission(): SubmissionRecord {
  return {
    id: 'submission_demo', organizationId: ORGANIZATION_ID, taskId: 'task_demo', assignmentId: 'assignment_demo', studentId: CHILD_ID,
    submissionVersion: 1, recordVersion: 1, status: 'reviewed', answers: [{ itemId: 'item_demo', value: '虚构作答' }],
    isLate: false, submittedAt: '2026-09-16T01:00:00.000Z', supersedesSubmissionId: null,
  };
}

function draftSubmission(): SubmissionRecord {
  return {
    ...submission(), id: 'submission_private_draft', submissionVersion: 2, recordVersion: 3, status: 'draft',
    answers: [{ itemId: 'item_demo', value: '未提交的家长不可见草稿' }], submittedAt: null,
    supersedesSubmissionId: 'submission_demo',
  };
}

function feedback(): ReviewFeedbackRecord {
  return {
    id: 'feedback_demo', organizationId: ORGANIZATION_ID, taskId: 'task_demo', assignmentId: 'assignment_demo',
    submissionId: 'submission_demo', submissionVersion: 1, teacherId: 'teacher_demo', decision: 'approved', score: 92,
    textComment: '完成得很好。', returnReason: null, publishedAt: '2026-09-16T02:00:00.000Z', source: 'manual',
  };
}

function harness(overrides: Readonly<{ task?: TaskRecord; assignment?: TaskAssignmentRecord; submission?: SubmissionRecord;
  extraTasks?: TaskRecord[]; extraAssignments?: TaskAssignmentRecord[];
  extraSubmissions?: SubmissionRecord[]; feedback?: ReviewFeedbackRecord | null;
  extraFeedback?: ReviewFeedbackRecord[] }> = {}) {
  const links: ParentStudentLinkRecord[] = [{
    _id: 'link_demo', organizationId: ORGANIZATION_ID, parentId: PARENT_ID, studentId: CHILD_ID,
    status: 'active', version: 1, deletedAt: null, confirmedAt: '2026-09-16T00:00:00.000Z',
  }];
  const identities = new InMemoryIdentityRepository({
    organizations: [],
    users: [{
      _id: CHILD_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小*',
      studentNumber: 'STU-DEMO-0032', classId: 'class_demo', className: '三年级 2 班',
      status: 'active', version: 1, deletedAt: null,
    }],
    identities: [], roles: [], teacherGrants: [], parentLinks: links,
  } satisfies AuthorizationFixture);
  const repository = new InMemoryTaskQueryRepository({
    tasks: [overrides.task ?? task(), ...(overrides.extraTasks ?? [])],
    assignments: [overrides.assignment ?? assignment(), ...(overrides.extraAssignments ?? [])],
    submissions: [overrides.submission ?? submission(), draftSubmission(), ...(overrides.extraSubmissions ?? [])],
    feedback: overrides.feedback === null ? [] : [overrides.feedback ?? feedback(), ...(overrides.extraFeedback ?? [])],
  });
  let sequence = 0;
  const service = new ParentTaskQueryService({
    repository, identities, clock: { nowIso: () => '2026-09-16T03:00:00.000Z' },
    requestIds: { next: () => `request_parent_query_${++sequence}` },
  });
  return { service, links };
}

describe('M1 家长只读查询', () => {
  it('只从可信家长身份列出当前有效关系的孩子安全视图', async () => {
    const { service, links } = harness();
    expect(await service.listChildren(parent)).toMatchObject({
      ok: true,
      data: [{
        linkId: 'link_demo', linkVersion: 1, childId: CHILD_ID, displayName: '小宇',
        studentNumber: 'STU-DEMO-0032', className: '三年级 2 班',
      }],
    });
    links[0] = { ...links[0], status: 'revoked', version: 2 };
    expect(await service.listChildren(parent)).toMatchObject({ ok: true, data: [] });
    expect(await service.listChildren({ ...parent, actorRole: 'student' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('首页、孩子任务、任务详情和反馈均返回安全视图并支持分页', async () => {
    const { service } = harness();
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({
      ok: true,
      data: {
        childId: CHILD_ID, pendingTaskCount: 0, completedTaskCount: 1,
        weeklyAssignedCount: 1, weeklyCompletedCount: 1, overdueTaskCount: 0,
        recentFeedback: [{ feedbackId: 'feedback_demo', taskId: 'task_demo', score: 92,
          teacherName: '任课教师', textComment: '完成得很好。' }],
      },
    });
    const list = await service.listChildTasks(parent, CHILD_ID, { status: 'completed' }, { limit: 1 });
    expect(list).toMatchObject({ ok: true, data: { total: 1, items: [{ taskId: 'task_demo', feedbackId: 'feedback_demo' }], nextCursor: null } });
    const detail = await service.getParentTaskResult(parent, CHILD_ID, 'task_demo');
    expect(detail).toMatchObject({ ok: true, data: { taskId: 'task_demo', studentId: CHILD_ID,
      assignmentId: 'assignment_demo',
      submission: { id: 'submission_demo' }, feedback: { id: 'feedback_demo' },
      submissionHistory: [{ id: 'submission_demo', version: 1, feedback: { id: 'feedback_demo', score: 92 } }] } });
    const feedbackDetail = await service.getFeedback(parent, CHILD_ID, 'feedback_demo');
    expect(feedbackDetail).toMatchObject({
      ok: true,
      data: { childId: CHILD_ID, taskTitle: '虚构阅读任务', submission: { id: 'submission_demo' }, feedback: { score: 92 } },
    });
    for (const result of [list, detail, feedbackDetail]) {
      expect(JSON.stringify(result)).not.toContain('家长不可见备注');
      expect(JSON.stringify(result)).not.toContain('teacher_demo');
      expect(JSON.stringify(result)).not.toContain('未提交的家长不可见草稿');
      expect(JSON.stringify(result)).not.toContain('submission_private_draft');
    }
  });

  it('首页周统计按全部授权任务计算，列表按学校日期和状态分组后分页', async () => {
    const nextTask: TaskRecord = { ...task(), id: 'task_next', title: '虚构新任务',
      dueAt: '2026-09-17T10:00:00.000Z' };
    const laterTask: TaskRecord = { ...task(), id: 'task_later', title: '虚构下月任务',
      dueAt: '2026-10-01T10:00:00.000Z' };
    const nextAssignment: TaskAssignmentRecord = { ...assignment(), id: 'assignment_next',
      taskId: nextTask.id, status: 'in_progress', latestSubmissionId: null,
      latestSubmissionVersion: 0, submittedAt: null, reviewedAt: null };
    const laterAssignment: TaskAssignmentRecord = { ...nextAssignment, id: 'assignment_later',
      taskId: laterTask.id };
    const { service } = harness({ extraTasks: [nextTask, laterTask],
      extraAssignments: [nextAssignment, laterAssignment] });
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({ ok: true, data: {
      pendingTaskCount: 2, completedTaskCount: 1, weeklyAssignedCount: 2,
      weeklyCompletedCount: 1, overdueTaskCount: 0,
    } });
    const page = await service.listChildTasks(parent, CHILD_ID,
      { startsOn: '2026-09-16', endsOn: '2026-09-18' }, { limit: 1 });
    expect(page).toMatchObject({ ok: true, data: { total: 2, items: [{ taskId: 'task_demo', score: 92 }],
      nextCursor: expect.any(String) } });
    if (!page.ok || !page.data.nextCursor) throw new Error('Expected second page');
    expect(await service.listChildTasks(parent, CHILD_ID,
      { startsOn: '2026-09-16', endsOn: '2026-09-18' }, { limit: 1, cursor: page.data.nextCursor }))
      .toMatchObject({ ok: true, data: { total: 2, items: [{ taskId: nextTask.id, score: null }],
        nextCursor: null } });
    expect(await service.listChildTasks(parent, CHILD_ID,
      { statusGroup: 'active', startsOn: '2026-09-16', endsOn: '2026-09-18' }, { limit: 20 }))
      .toMatchObject({ ok: true, data: { total: 1, items: [{ taskId: nextTask.id }] } });
  });

  it('家长日期过滤拒绝无效日期及不完整区间', () => {
    const request = (filters: object) => validateParentQueryRequest({ apiVersion: 'm1.v1',
      action: 'listChildTasks', payload: { childId: CHILD_ID, filters, page: { limit: 20 } } });
    expect(request({ startsOn: '2026-02-30', endsOn: '2026-03-03' })).toMatchObject({ ok: false });
    expect(request({ startsOn: '2026-09-16' })).toMatchObject({ ok: false });
    expect(request({ startsOn: '2026-09-18', endsOn: '2026-09-16' })).toMatchObject({ ok: false });
    expect(request({ statusGroup: 'active', startsOn: '2026-09-16', endsOn: '2026-09-18' }))
      .toMatchObject({ ok: true });
  });

  it('每次请求重新校验 active parent link，解绑后首页、列表、详情和反馈立即统一失权', async () => {
    const { service, links } = harness();
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({ ok: true });
    links[0] = { ...links[0], status: 'revoked', version: 2 };
    expect(await service.getHome(parent, CHILD_ID)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.listChildTasks(parent, CHILD_ID, {}, { limit: 10 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getParentTaskResult(parent, CHILD_ID, 'task_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getFeedback(parent, CHILD_ID, 'feedback_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('只按已正式提交的版本返回历史点评，当前未点评版本不复用旧分', async () => {
    const latest: SubmissionRecord = { ...submission(), id: 'submission_second', submissionVersion: 2,
      status: 'submitted', submittedAt: '2026-09-17T01:00:00.000Z', supersedesSubmissionId: 'submission_demo' };
    const { service } = harness({ assignment: { ...assignment(), latestSubmissionId: latest.id,
      latestSubmissionVersion: 2, status: 'awaiting_review' }, extraSubmissions: [latest] });
    const result = await service.getParentTaskResult(parent, CHILD_ID, 'task_demo');
    expect(result).toMatchObject({ ok: true, data: { feedback: null,
      submissionHistory: [{ id: latest.id, version: 2, feedback: null },
        { id: 'submission_demo', version: 1, feedback: { id: 'feedback_demo', score: 92 } }] } });
    expect(JSON.stringify(result)).not.toContain('未提交的家长不可见草稿');
  });

  it('每个家长查询入口均实时要求 child.read，角色存在但业务权限撤销后立即拒绝', async () => {
    const { service } = harness();
    const revoked = { ...parent, permissions: [] };

    expect(await service.listChildren(revoked)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await service.getHome(revoked, CHILD_ID)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.listChildTasks(revoked, CHILD_ID, {}, { limit: 10 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getParentTaskResult(revoked, CHILD_ID, 'task_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await service.getFeedback(revoked, CHILD_ID, 'feedback_demo')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('M2 家长自动分只读口径', () => {
  it('未点评时显示当前提交的自动分，同时不泄露任务快照答案', async () => {
    const exerciseTask: TaskRecord = { ...task(), items: [{
      id: 'item_demo', resourceId: 'question_demo', resourceVersion: 1, snapshotSchemaVersion: 1,
      resourceSnapshot: { title: '动物选择题', type: 'exercise', payload: {
        questionIds: ['question_demo'], questionType: 'single_choice', stem: 'Which animal can fly?',
        options: ['A. bird', 'B. lion'], correctAnswer: 'A. bird', explanation: 'Birds can fly.',
      } }, completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1,
    }] };
    const exerciseSubmission: SubmissionRecord = { ...submission(), status: 'submitted', answers: [{
      itemId: 'item_demo', value: { kind: 'exercise', answeredQuestionCount: 1, correctQuestionCount: 1,
        questionResponses: [{ questionId: 'question_demo', response: 'A. bird', isCorrect: true }] },
    }] };
    const { service } = harness({ task: exerciseTask, assignment: { ...assignment(), status: 'awaiting_review' },
      submission: exerciseSubmission, feedback: null });
    const result = await service.getParentTaskResult(parent, CHILD_ID, 'task_demo');
    expect(result).toMatchObject({ ok: true, data: { automaticScore: 100, feedback: null } });
    expect(JSON.stringify(result)).not.toContain('correctAnswer');
    expect(JSON.stringify(result)).not.toContain('Birds can fly.');
  });

  it('试验性计分标记不能进入家长正式自动成绩', async () => {
    const experimentalTask: TaskRecord = { ...task(), items: [{
      id: 'item_demo', resourceId: 'question_demo', resourceVersion: 1, snapshotSchemaVersion: 1,
      resourceSnapshot: { title: '虚构习题', type: 'exercise', payload: {
        questionIds: ['question_demo'], questionType: 'single_choice', stem: 'A?',
        options: ['A', 'B'], correctAnswer: 'A', explanation: '虚构解析',
      } }, completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100, experimental: true }, order: 1,
    }] };
    const answered: SubmissionRecord = { ...submission(), answers: [{ itemId: 'item_demo', value: {
      kind: 'exercise', answeredQuestionCount: 1, correctQuestionCount: 1,
      questionResponses: [{ questionId: 'question_demo', response: 'A', isCorrect: true }],
    } }] };
    const { service } = harness({ task: experimentalTask, submission: answered, feedback: null });
    expect(await service.getParentTaskResult(parent, CHILD_ID, 'task_demo'))
      .toMatchObject({ ok: true, data: { automaticScore: null, feedback: null } });
  });
});

describe('M3 家长提交证据最小投影', () => {
  it('正式听力/视频/任务配音只展示快照题目与本人结果，不泄露媒体会话、答案键或作品 ID', async () => {
    const mediaSnapshot = { mediaId: 'media_demo', kind: 'listening' as const,
      mediaVersion: 3, reviewVersion: 3, mediaAssetKey: 'cloud://private/listening.mp3',
      mediaSha256: 'a'.repeat(64), durationMs: 10000,
      questionIds: ['question_1'], questions: [{ questionId: 'question_1',
        questionType: 'single_choice' as const, stem: 'Which animal?', options: ['cat', 'dog'] }],
      answerKeys: [{ questionId: 'question_1', correctAnswer: 'cat', explanation: 'private answer' }],
      clips: [{ questionId: 'question_1', segmentId: 'segment_1', startMs: 0, endMs: 10000 }],
      continuousPlaybackEnforced: true as const };
    const listeningTask: TaskRecord = { ...task(), items: [{ id: 'item_listening', resourceId: 'media_demo',
      resourceVersion: 3, snapshotSchemaVersion: 2,
      resourceSnapshot: { title: '虚构听力', type: 'listening', payload: {} }, mediaSnapshot,
      completionRule: { kind: 'listening', segmentIds: ['segment_1'], questionIds: ['question_1'] },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }] };
    const answer: SubmissionRecord = { ...submission(), answers: [{ itemId: 'item_listening', value: {
      kind: 'listening', mediaSessionId: 'private_session', mediaId: 'media_demo', mediaVersion: 3,
      questionResponses: [{ questionId: 'question_1', response: 'cat' }],
      verifiedPlayedSegmentIds: ['segment_1'], answeredQuestionIds: ['question_1'],
      correctQuestionIds: ['question_1'],
    } }] };
    const { service } = harness({ task: listeningTask, submission: answer, feedback: null });
    const result = await service.getParentTaskResult(parent, CHILD_ID, listeningTask.id);
    expect(result).toMatchObject({ ok: true, data: { automaticScore: 100,
      submission: { answers: [{ value: { kind: 'listening', playedSegmentCount: 1,
        answeredQuestionCount: 1, questions: [{ questionId: 'question_1', stem: 'Which animal?',
          response: 'cat', isCorrect: true }] } }] } } });
    expect(JSON.stringify(result)).not.toMatch(/private_session|cloud:\/\/private|private answer|answerKeys/);

    const videoTask: TaskRecord = { ...task(), items: [{ ...listeningTask.items[0]!,
      id: 'item_video', resourceSnapshot: { title: '虚构视频', type: 'video', payload: {} },
      mediaSnapshot: { ...mediaSnapshot, kind: 'video', questionIds: [], questions: [], answerKeys: [], clips: [] },
      completionRule: { kind: 'video', durationMs: 10000, questionIds: [] },
      scoringRule: { kind: 'completion_only' } }] };
    const safeVideo = parentSafeAnswers(videoTask, [{ itemId: 'item_video', value: {
      kind: 'video', mediaSessionId: 'private_video_session', mediaId: 'media_demo', mediaVersion: 3,
      questionResponses: [], verifiedRanges: [{ startMs: 0, endMs: 9000 }],
      answeredQuestionIds: [], correctQuestionIds: [],
    } }], submission().submittedAt, '2026-09-16T03:00:00.000Z');
    expect(safeVideo[0].value).toMatchObject({ kind: 'video', verifiedPlayedMs: 9000,
      durationMs: 10000, answeredQuestionCount: 0 });
    expect(JSON.stringify(safeVideo)).not.toContain('private_video_session');
    const skippedStart = parentSafeAnswers(videoTask, [{ itemId: 'item_video', value: {
      kind: 'video', mediaSessionId: 'private_video_session', mediaId: 'media_demo', mediaVersion: 3,
      questionResponses: [], verifiedRanges: [{ startMs: 1000, endMs: 10000 }],
      answeredQuestionIds: [], correctQuestionIds: [],
    } }], submission().submittedAt, '2026-09-16T03:00:00.000Z');
    expect(skippedStart[0].value).toEqual({ kind: 'unavailable' });

    const dubbingTask: TaskRecord = { ...task(), items: [{ ...listeningTask.items[0]!,
      id: 'item_dubbing', resourceSnapshot: { title: '虚构配音', type: 'dubbing', payload: {} },
      mediaSnapshot: { ...mediaSnapshot, kind: 'dubbing', questionIds: [], questions: [], answerKeys: [], clips: [] },
      completionRule: { kind: 'dubbing' }, scoringRule: { kind: 'manual', maxScore: 100 } }] };
    const safeDubbing = parentSafeAnswers(dubbingTask, [{ itemId: 'item_dubbing', value: {
      kind: 'dubbing', mediaSessionId: 'private_dubbing_session', mediaId: 'media_demo', mediaVersion: 3,
      finalWorkId: 'private_work', questionResponses: [], recording: {
        mediaId: 'private_recording', durationMs: 2300, sizeBytes: 12000, serverReadable: true,
      },
    } }], submission().submittedAt, '2026-09-16T03:00:00.000Z');
    expect(safeDubbing[0].value).toEqual({ kind: 'dubbing', submitted: true, durationMs: 2300 });
    expect(JSON.stringify(safeDubbing)).not.toMatch(/private_work|private_recording|private_dubbing_session/);
  });
  it('已发布语音评语只投影可用状态与时长，不投影私有媒体引用', async () => {
    const publishedVoice = { ...feedback(), voiceComment: { recordingId: 'private_voice_recording',
      fileId: 'cloud://private/voice', durationMs: 2300, mediaVersion: 1,
      sha256: 'a'.repeat(64) } } as ReviewFeedbackRecord;
    const { service } = harness({ feedback: publishedVoice });
    const result = await service.getParentTaskResult(parent, CHILD_ID, 'task_demo');
    expect(result).toMatchObject({ ok: true, data: {
      feedback: { voiceComment: { available: true, durationMs: 2300 } },
      submissionHistory: [{ feedback: { voiceComment: { available: true, durationMs: 2300 } } }],
    } });
    expect(JSON.stringify(result)).not.toMatch(/private_voice_recording|cloud:\/\/private/);
  });
  it('只有已审核并冻结句段的阅读任务才给家长跟读记录入口标记', async () => {
    const approvedTask: TaskRecord = { ...task(), items: [{ id: 'item_reading', resourceId: 'book_demo',
      resourceVersion: 1, snapshotSchemaVersion: 2,
      resourceSnapshot: { title: '虚构绘本', type: 'reading', payload: {
        pronunciation: { reviewStatus: 'approved', sourceVersion: 'v1', segments: [{ id: 'segment_demo' }] },
      } }, completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }] };
    const { service } = harness({ task: approvedTask, feedback: null });
    expect(await service.getParentTaskResult(parent, CHILD_ID, approvedTask.id))
      .toMatchObject({ ok: true, data: { itemSummaries: [{ itemId: 'item_reading',
        title: '虚构绘本', pronunciationAvailable: true }] } });
  });
  it('隐藏录音私有 ID 和服务端阅读证据，180 天后仅保留历史说明', async () => {
    const recordingTask: TaskRecord = { ...task(), items: [{ id: 'item_recording', resourceId: 'prompt_demo',
      resourceVersion: 1, snapshotSchemaVersion: 1,
      resourceSnapshot: { title: '虚构录音', type: 'recording', payload: {} },
      completionRule: { kind: 'recording_upload' }, scoringRule: { kind: 'manual', maxScore: 100 }, order: 1 }] };
    const submitted: SubmissionRecord = { ...submission(), answers: [{ itemId: 'item_recording', value: {
      kind: 'recording', recordingId: 'private_recording_demo', fileId: 'cloud://private/file',
      durationMs: 1500, sizeBytes: 12000,
    } }] };
    const { service } = harness({ task: recordingTask, submission: submitted, feedback: null });
    const result = await service.getParentTaskResult(parent, CHILD_ID, recordingTask.id);
    expect(result).toMatchObject({ ok: true, data: { submission: { answers: [{ itemId: 'item_recording',
      value: { kind: 'recording', durationMs: 1500, mediaExpired: false } }] },
      itemSummaries: [{ itemId: 'item_recording', title: '虚构录音', type: 'recording', order: 1 }] } });
    expect(JSON.stringify(result)).not.toContain('private_recording_demo');
    expect(JSON.stringify(result)).not.toContain('cloud://private/file');
    expect(parentSafeAnswers(recordingTask, submitted.answers, submitted.submittedAt,
      '2027-03-16T01:00:00.000Z')[0].value).toMatchObject({ kind: 'recording', mediaExpired: true });
    const readingTask: TaskRecord = { ...task(), items: [{ id: 'item_reading', resourceId: 'book_demo',
      resourceVersion: 1, snapshotSchemaVersion: 1,
      resourceSnapshot: { title: '虚构绘本', type: 'reading', payload: {} },
      completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
      scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }] };
    const safeReading = parentSafeAnswers(readingTask, [{ itemId: 'item_reading', value: {
      kind: 'reading', completedPageCount: 1,
      verifiedPageEvents: [{ pageId: 'private_page', visitedAt: '2026-09-16T01:00:00.000Z' }],
    } }], submitted.submittedAt, '2026-09-16T03:00:00.000Z');
    expect(safeReading[0].value).toEqual({ kind: 'reading', completedPageCount: 1 });
    expect(JSON.stringify(safeReading)).not.toContain('private_page');
    expect(parentSafeAnswers(task(), [{ itemId: 'legacy', value: '{"fileId":"cloud://private/old"}' }],
      submitted.submittedAt, '2026-09-16T03:00:00.000Z')[0].value).toEqual({ kind: 'unavailable' });
  });
});
