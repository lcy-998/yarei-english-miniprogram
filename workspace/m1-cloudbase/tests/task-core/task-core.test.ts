import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import {
  InMemoryIdentityRepository,
  type AuthorizationFixture,
} from '../../src/runtime/memory-ports';
import { InMemoryTaskCoreRepository } from '../../src/task-core/memory-repository';
import { TaskCoreService } from '../../src/task-core/task-core-service';
import type { ParentStudentLinkRecord, TeacherClassGrantRecord } from '../../src/runtime/records';
import type { JsonObject } from '../../src/shared/protocol';
import type { ReadingPageEventRecord } from '../../src/learning-progress/types';
import type { LearningResourceType } from '../../src/task-core/types';
import type { TaskRecordingRecord } from '../../src/task-recording/types';
import type { TaskTemplate } from '../../src/task-template/types';
import type { BatchReviewPreviewCodec } from '../../src/task-core/batch-review-preview';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { InMemoryOpaqueCursorCodec, ReviewQueryService, StudentTaskQueryService, TeacherTaskQueryService } from '../../src/task-query/service';

const ORGANIZATION_ID = 'org_demo';
const CLASS_ID = 'class_grade3_2';
const TEACHER_ID = 'user_teacher_lin';
const STUDENT_ID = 'user_student_xiaoyu';
const PARENT_ID = 'user_parent_xiaoyu';

const teacher: TrustedActorContext = {
  requestId: 'request_teacher',
  sessionId: 'session_teacher',
  actorUserId: TEACHER_ID,
  actorRole: 'teacher',
  organizationId: ORGANIZATION_ID,
  platformSubjectDigest: 'digest_teacher',
  permissions: ['task.publish', 'submission.review', 'content.read'],
  scopeIds: [CLASS_ID],
  authzVersion: 1,
};

const student: TrustedActorContext = {
  ...teacher,
  requestId: 'request_student',
  sessionId: 'session_student',
  actorUserId: STUDENT_ID,
  actorRole: 'student',
  permissions: [],
  scopeIds: [STUDENT_ID],
};

const parent: TrustedActorContext = {
  ...teacher,
  requestId: 'request_parent',
  sessionId: 'session_parent',
  actorUserId: PARENT_ID,
  actorRole: 'parent',
  permissions: ['child.read'],
  scopeIds: [PARENT_ID],
};

interface TestHarness {
  readonly service: TaskCoreService;
  readonly repository: InMemoryTaskCoreRepository;
  readonly teacherGrants: TeacherClassGrantRecord[];
  readonly parentLinks: ParentStudentLinkRecord[];
}

function exerciseResult(responseKey: string): Readonly<Record<string, string | number>> {
  return { kind: 'exercise', answeredQuestionCount: 1, responseKey };
}

const BATCH_OBJECTIVE_PAYLOAD: JsonObject = { questionIds: ['resource_demo_exercise'], questionType: 'single_choice',
  stem: '虚构选择题', options: ['giraffe', 'elephant'], correctAnswer: 'giraffe', explanation: '虚构题解析' };
function batchObjectiveAnswer(response: string): JsonObject {
  return { kind: 'exercise', answeredQuestionCount: 1,
    questionResponses: [{ questionId: 'resource_demo_exercise', response }] };
}

function createHarness(options: Readonly<{
  failAudit?: boolean;
  studentCount?: number;
  resourceType?: LearningResourceType;
  resourcePayload?: JsonObject;
  readingPageEvents?: readonly ReadingPageEventRecord[];
  withLearningProgress?: boolean;
  batchReviewPreviewCodec?: BatchReviewPreviewCodec;
  templates?: readonly TaskTemplate[];
  nowIso?: () => string;
}> = {}): TestHarness {
  const teacherGrants: TeacherClassGrantRecord[] = [{
    _id: 'grant_teacher_class',
    organizationId: ORGANIZATION_ID,
    teacherId: TEACHER_ID,
    classId: CLASS_ID,
    status: 'active',
    permissions: ['task.publish', 'submission.review', 'content.read'],
    version: 1,
    deletedAt: null,
  }];
  const parentLinks: ParentStudentLinkRecord[] = [{
    _id: 'link_parent_student',
    organizationId: ORGANIZATION_ID,
    parentId: PARENT_ID,
    studentId: STUDENT_ID,
    status: 'active',
    version: 1,
    deletedAt: null,
  }];
  const authorization: AuthorizationFixture = {
    organizations: [{ _id: ORGANIZATION_ID, organizationId: ORGANIZATION_ID, name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai', version: 1, deletedAt: null }],
    users: [
      { _id: TEACHER_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '林老师', displayNameMasked: '林老师', status: 'active', version: 1, deletedAt: null },
      { _id: STUDENT_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '小宇', displayNameMasked: '小宇', status: 'active', version: 1, deletedAt: null },
      { _id: PARENT_ID, organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '小宇家长', displayNameMasked: '小宇家长', status: 'active', version: 1, deletedAt: null },
    ],
    identities: [],
    roles: [],
    teacherGrants,
    parentLinks,
  };
  const repository = new InMemoryTaskCoreRepository({
    teacherGrants,
    templates: options.templates,
    readingProgress: options.resourceType === 'reading' && options.withLearningProgress !== false ? [{
      id: 'reading_progress_demo', organizationId: ORGANIZATION_ID, studentId: STUDENT_ID,
      resourceId: 'resource_demo_exercise', chapterId: 'chapter_demo', pageId: 'page_demo_03', pageNumber: 3,
      favorite: false, version: 1, updatedAt: '2026-09-16T01:00:00.000Z',
    }] : [],
    readingPageEvents: options.readingPageEvents,
    vocabularyProgress: options.resourceType === 'vocabulary' && options.withLearningProgress !== false ? [{
      id: 'vocabulary_progress_demo', organizationId: ORGANIZATION_ID, studentId: STUDENT_ID,
      packId: 'resource_demo_exercise', completedCount: 5, correctCount: 4, correctRate: 80,
      wrongWordIds: [], version: 1, updatedAt: '2026-09-16T01:00:00.000Z',
    }] : [],
    resources: [{
      id: 'resource_demo_exercise',
      organizationId: ORGANIZATION_ID,
      type: options.resourceType ?? 'exercise',
      title: '动物主题虚构练习',
      contentVersion: 3,
      status: 'published',
      visibility: 'classes',
      allowedClassIds: [CLASS_ID],
      payload: options.resourcePayload ?? { promptKey: 'demo_animals_v3', points: 100 },
    }],
    memberships: Array.from({ length: options.studentCount ?? 1 }, (_, index) => ({
      id: `membership_${index + 1}`,
      organizationId: ORGANIZATION_ID,
      classId: CLASS_ID,
      studentId: index === 0 ? STUDENT_ID : `user_student_demo_${index + 1}`,
      status: 'active' as const,
    })),
  });
  const identityRepository = new InMemoryIdentityRepository(authorization);
  if (options.failAudit === true) repository.failNext('audit.append');
  let sequence = 0;
  const ids = { next: (prefix: string): string => `${prefix}_${++sequence}` };
  const clock = { nowIso: options.nowIso ?? ((): string => '2026-09-16T02:00:00.000Z') };
  const service = new TaskCoreService(
    repository,
    identityRepository,
    clock,
    ids,
    ids,
    options.batchReviewPreviewCodec,
  );
  return { service, repository, teacherGrants, parentLinks };
}

async function publishSingleStudentTask(
  harness: TestHarness,
  completionRule: JsonObject = { kind: 'exercise_questions', requiredQuestionCount: 1 },
  scoringRule: JsonObject = { kind: 'manual', maxScore: 100 },
): Promise<string> {
  const draft = await harness.service.saveTaskDraft(teacher, {
    title: '动物主题听说练习',
    itemRefs: [{
      id: 'item_exercise',
      resourceId: 'resource_demo_exercise',
      completionRule,
      scoringRule,
      order: 1,
    }],
    targetClassIds: [CLASS_ID],
    startsAt: '2026-09-16T00:00:00.000Z',
    dueAt: '2026-09-16T12:00:00.000Z',
    latePolicy: { allowLate: true, lateDays: 7 },
    description: '完成这份虚构练习。',
    teacherNote: '仅教师可见的虚构备注。',
  }, 0, 'operation_save_task_0001');
  expect(draft.ok).toBe(true);
  if (!draft.ok) throw new Error('draft expected');
  const taskId = draft.data.taskId;
  if (typeof taskId !== 'string') throw new Error('taskId expected');
  const published = await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_task_0001');
  expect(published).toMatchObject({ ok: true, data: { version: 2 } });
  return taskId;
}

describe('T-07 再次布置的服务端快照', () => {
  const originalReading = { chapters: [{ id: 'chapter_demo', pages: [{ id: 'page_demo_03',
    imageAssetKey: 'demo/original-page', thumbnailAssetKey: 'demo/original-thumb', pageNumber: 3, order: 1 }] }] };

  async function publishedReading(harness: TestHarness): Promise<string> {
    const saved = await harness.service.saveTaskDraft(teacher, {
      title: '原阅读任务', itemRefs: [{ id: 'item_reading', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: ['page_demo_03'] },
        scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 }, description: '原说明', teacherNote: '原备注',
    }, 0, 'operation_copy_source_save');
    if (!saved.ok) throw new Error('expected source draft');
    const id = saved.data.taskId as string;
    let result = await harness.service.publishTask(teacher, id, 1, 'operation_copy_source_publish');
    for (let retry = 0; result.ok && result.data.status === 'publishing' && retry < 10; retry += 1) {
      result = await harness.service.publishTask(teacher, id, 1, 'operation_copy_source_publish');
    }
    expect(result).toMatchObject({ ok: true });
    if (!result.ok || result.data.status === 'publishing') throw new Error('expected published source');
    return id;
  }

  it('原资源换图后仍以原页图、页序和规则发布新任务；对象、日期与提交不复用', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalReading });
    const sourceId = await publishedReading(harness);
    harness.repository.upsertResource({ id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID,
      type: 'reading', title: '新版绘本', contentVersion: 4, status: 'published',
      visibility: 'classes', allowedClassIds: [CLASS_ID],
      payload: { chapters: [{ id: 'chapter_demo', pages: [{ id: 'page_demo_03', imageAssetKey: 'demo/revised-page' }] }] } });
    const copied = await harness.service.copyTaskSnapshot(teacher, sourceId, 2, 'operation_copy_snapshot');
    expect(copied).toMatchObject({ ok: true, data: { status: 'draft', version: 1 } });
    if (!copied.ok) throw new Error('expected copied draft');
    const copyId = copied.data.taskId as string;
    expect(await harness.service.copyTaskSnapshot(teacher, sourceId, 2, 'operation_copy_snapshot')).toMatchObject({
      ok: true, data: { taskId: copyId },
    });
    let draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === copyId)!;
    expect(draft).toMatchObject({ title: '原阅读任务', description: '原说明', teacherNote: '原备注', copiedFromTaskId: sourceId,
      targetClassIds: [], targetStudentIds: [], startsAt: '', dueAt: '', publishedAt: null,
      items: [{ resourceVersion: 3, resourceSnapshot: { title: '动物主题虚构练习',
        payload: { chapters: [{ pages: [{ imageAssetKey: 'demo/original-page' }] }] } } }] });
    expect(harness.repository.debugSnapshot().assignments.filter((item) => item.taskId === copyId)).toHaveLength(0);
    expect(await harness.service.publishTask(teacher, copyId, 1, 'operation_copy_publish_too_early'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const updated = await harness.service.saveTaskDraft(teacher, {
      title: draft.title, itemRefs: draft.itemRefs, targetClassIds: [CLASS_ID],
      startsAt: '2026-09-17T00:00:00.000Z', dueAt: '2026-09-18T00:00:00.000Z',
      latePolicy: draft.latePolicy, description: draft.description ?? undefined,
      teacherNote: draft.teacherNote ?? undefined,
      taskId: copyId,
    }, 1, 'operation_copy_fill_target');
    expect(updated).toMatchObject({ ok: true, data: { version: 2 } });
    expect(harness.repository.debugSnapshot().tasks.find((task) => task.id === copyId)?.copiedFromTaskId).toBe(sourceId);
    expect(await harness.service.publishTask(teacher, copyId, 2, 'operation_copy_publish')).toMatchObject({ ok: true });
    draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === copyId)!;
    expect(draft.items[0]?.resourceVersion).toBe(3);
    expect(draft.items[0]?.resourceSnapshot.payload).toEqual(originalReading);
    expect(draft.items[0]?.completionRule).toEqual({ kind: 'reading_pages', requiredPageCount: 1, pageIds: ['page_demo_03'] });
    expect(harness.repository.debugSnapshot().assignments.filter((item) => item.taskId === copyId)).toHaveLength(1);
  });

  it('拒绝越权复制及原内容下架后的新发布', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalReading });
    const sourceId = await publishedReading(harness);
    expect(await harness.service.copyTaskSnapshot(student, sourceId, 2, 'operation_student_copy'))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await harness.service.copyTaskSnapshot(teacher, sourceId, 1, 'operation_stale_copy'))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const copied = await harness.service.copyTaskSnapshot(teacher, sourceId, 2, 'operation_pre_offline_copy');
    if (!copied.ok) throw new Error('expected copied draft');
    const copyId = copied.data.taskId as string;
    const draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === copyId)!;
    harness.repository.upsertResource({ id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID,
      type: 'reading', title: '原绘本', contentVersion: 3, status: 'offline',
      visibility: 'classes', allowedClassIds: [CLASS_ID], payload: originalReading });
    expect(await harness.service.copyTaskSnapshot(teacher, sourceId, 2, 'operation_offline_copy'))
      .toMatchObject({ ok: false, error: { code: 'RESOURCE_OFFLINE' } });
    expect(await harness.service.saveTaskDraft(teacher, { taskId: copyId, title: draft.title,
      itemRefs: draft.itemRefs, targetClassIds: [CLASS_ID], startsAt: '2026-09-17T00:00:00.000Z',
      dueAt: '2026-09-18T00:00:00.000Z', latePolicy: draft.latePolicy }, 1, 'operation_offline_fill'))
      .toMatchObject({ ok: true });
    expect(await harness.service.publishTask(teacher, copyId, 2, 'operation_offline_publish'))
      .toMatchObject({ ok: false, error: { code: 'RESOURCE_OFFLINE' } });
  });

  it('超过单事务人数时分批发布仍保留原快照', async () => {
    const harness = createHarness({ studentCount: 68, resourceType: 'reading', resourcePayload: originalReading });
    const sourceId = await publishedReading(harness);
    harness.repository.upsertResource({ id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID,
      type: 'reading', title: '新版绘本', contentVersion: 4, status: 'published', visibility: 'classes',
      allowedClassIds: [CLASS_ID], payload: { chapters: [{ id: 'chapter_demo', pages: [{ id: 'page_demo_03',
        imageAssetKey: 'demo/new-page' }] }] } });
    const sourceVersion = harness.repository.debugSnapshot().tasks.find((task) => task.id === sourceId)?.version;
    if (sourceVersion === undefined) throw new Error('expected source');
    const copied = await harness.service.copyTaskSnapshot(teacher, sourceId, sourceVersion, 'operation_large_copy');
    expect(copied).toMatchObject({ ok: true });
    if (!copied.ok) throw new Error('expected copied draft');
    const copyId = copied.data.taskId as string;
    const draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === copyId)!;
    expect(await harness.service.saveTaskDraft(teacher, { taskId: copyId, title: draft.title,
      itemRefs: draft.itemRefs, targetClassIds: [CLASS_ID], startsAt: '2026-09-17T00:00:00.000Z',
      dueAt: '2026-09-18T00:00:00.000Z', latePolicy: draft.latePolicy }, 1, 'operation_large_fill'))
      .toMatchObject({ ok: true });
    let result = await harness.service.publishTask(teacher, copyId, 2, 'operation_large_copy_publish');
    for (let retry = 0; result.ok && result.data.status === 'publishing' && retry < 10; retry += 1) {
      result = await harness.service.publishTask(teacher, copyId, 2, 'operation_large_copy_publish');
    }
    expect(result).toMatchObject({ ok: true, data: { assignmentCount: 68 } });
    expect(harness.repository.debugSnapshot().tasks.find((task) => task.id === copyId)?.items[0]?.resourceSnapshot.payload)
      .toEqual(originalReading);
  });

  it('旧版无评分项与缺少题干答案的快照不被转成自动或人工评分', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalReading });
    const saved = await harness.service.saveTaskDraft(teacher, { title: '旧版无评分任务',
      itemRefs: [{ id: 'item_reading', resourceId: 'resource_demo_exercise', order: 1,
        completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: ['page_demo_03'] },
        scoringRule: { kind: 'completion_only' } }], targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 } }, 0, 'operation_unscored_save');
    if (!saved.ok) throw new Error('expected draft');
    const sourceId = saved.data.taskId as string;
    expect(await harness.service.publishTask(teacher, sourceId, 1, 'operation_unscored_publish')).toMatchObject({ ok: true });
    expect(await harness.service.copyTaskSnapshot(teacher, sourceId, 2, 'operation_unscored_copy'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const legacy = createHarness();
    const legacyId = await publishSingleStudentTask(legacy);
    expect(await legacy.service.copyTaskSnapshot(teacher, legacyId, 2, 'operation_legacy_copy'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('拒绝当前布置表单无法保真的额外完成或计分字段', async () => {
    for (const [index, extra] of [
      { completion: { audioThresholdPercent: 90 }, scoring: {} },
      { completion: {}, scoring: { aiDimension: 'fluency' } },
    ].entries()) {
      const harness = createHarness({ resourceType: 'reading', resourcePayload: originalReading });
      const saved = await harness.service.saveTaskDraft(teacher, { title: '保真校验任务',
        itemRefs: [{ id: 'item_reading', resourceId: 'resource_demo_exercise', order: 1,
          completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: ['page_demo_03'], ...extra.completion },
          scoringRule: { kind: 'automatic', maxScore: 100, ...extra.scoring } }],
        targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
        latePolicy: { allowLate: true, lateDays: 7 } }, 0, `operation_extra_source_${index}`);
      if (!saved.ok) throw new Error('expected source draft');
      const sourceId = saved.data.taskId as string;
      expect(await harness.service.publishTask(teacher, sourceId, 1, `operation_extra_publish_${index}`))
        .toMatchObject({ ok: true });
      expect(await harness.service.copyTaskSnapshot(teacher, sourceId, 2, `operation_extra_copy_${index}`))
        .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    }
  });
});

describe('T-10 模板实例化的服务端快照', () => {
  const originalPayload: JsonObject = { chapters: [{ id: 'chapter_demo', pages: [{ id: 'page_demo_03',
    imageAssetKey: 'demo/template-original', thumbnailAssetKey: 'demo/template-thumb', pageNumber: 3, order: 1 }] }] };
  const reference = { id: 'item_template_reading', resourceId: 'resource_demo_exercise', order: 1,
    completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: ['page_demo_03'] },
    scoringRule: { kind: 'automatic', maxScore: 100 } } as const;
  function template(scope: 'personal' | 'system' = 'personal', ownerTeacherId: string | null = TEACHER_ID): TaskTemplate {
    return { id: 'template_demo', organizationId: ORGANIZATION_ID, ownerTeacherId, scope,
      title: '虚构阅读模板', description: '按指定页阅读', itemRefs: [reference],
      items: [{ id: reference.id, resourceId: reference.resourceId, resourceVersion: 3,
        snapshotSchemaVersion: 1, resourceSnapshot: { title: '原版绘本', type: 'reading', payload: originalPayload },
        completionRule: reference.completionRule, scoringRule: reference.scoringRule, order: 1 }],
      status: 'active', useCount: 0, version: 1,
      createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T00:00:00.000Z' };
  }

  it('资源换页图仍从冻结模板生成独立草稿，使用次数与草稿一次事务且幂等', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalPayload,
      templates: [template()] });
    harness.repository.upsertResource({ id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID,
      type: 'reading', title: '新版绘本', contentVersion: 4, status: 'published', visibility: 'classes',
      allowedClassIds: [CLASS_ID], payload: { chapters: [{ id: 'chapter_demo', pages: [{ id: 'page_demo_03',
        imageAssetKey: 'demo/template-revised' }] }] } });
    const used = await harness.service.instantiateTemplate(teacher, 'template_demo', 1, 'operation_template_instantiate');
    expect(used).toMatchObject({ ok: true, data: { status: 'draft', version: 1, templateVersion: 2 } });
    if (!used.ok) throw new Error('expected template draft');
    const draftId = used.data.taskId as string;
    expect(await harness.service.instantiateTemplate(teacher, 'template_demo', 1, 'operation_template_instantiate'))
      .toMatchObject({ ok: true, data: { taskId: draftId } });
    expect(harness.repository.debugSnapshot().templates[0]).toMatchObject({ useCount: 1, version: 2 });
    let draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === draftId)!;
    expect(draft).toMatchObject({ copiedFromTemplateId: 'template_demo', targetClassIds: [],
      targetStudentIds: [], startsAt: '', dueAt: '', teacherNote: null,
      items: [{ resourceVersion: 3, resourceSnapshot: { payload: originalPayload } }] });
    expect(harness.repository.debugSnapshot().assignments.filter((row) => row.taskId === draftId)).toHaveLength(0);
    await harness.repository.saveTemplate({ ...template(), title: '后来修改的模板', version: 3,
      items: [{ ...template().items[0]!, resourceVersion: 4,
        resourceSnapshot: { title: '新版绘本', type: 'reading', payload: { chapters: [{ id: 'chapter_demo',
          pages: [{ id: 'page_demo_03', imageAssetKey: 'demo/template-revised' }] }] } } }],
      useCount: 1, updatedAt: '2026-09-16T03:00:00.000Z' });
    expect(await harness.service.instantiateTemplate(teacher, 'template_demo', 2, 'operation_template_stale'))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === draftId)!;
    expect(await harness.service.saveTaskDraft(teacher, { taskId: draftId, title: draft.title,
      itemRefs: draft.itemRefs, targetClassIds: [CLASS_ID], startsAt: '2026-09-17T00:00:00.000Z',
      dueAt: '2026-09-18T00:00:00.000Z', latePolicy: draft.latePolicy,
      description: draft.description ?? undefined }, 1, 'operation_template_target'))
      .toMatchObject({ ok: true, data: { version: 2 } });
    expect(await harness.service.publishTask(teacher, draftId, 2, 'operation_template_publish'))
      .toMatchObject({ ok: true });
    draft = harness.repository.debugSnapshot().tasks.find((task) => task.id === draftId)!;
    expect(draft.items[0]?.resourceSnapshot.payload).toEqual(originalPayload);
    expect(draft.title).toBe('虚构阅读模板');
    expect(draft.copiedFromTemplateId).toBe('template_demo');
    expect(harness.repository.debugSnapshot().templates[0]).toMatchObject({ useCount: 1, version: 3 });
  });

  it('教师能回收自己从模板生成的未选择对象草稿', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalPayload,
      templates: [template()] });
    const used = await harness.service.instantiateTemplate(teacher, 'template_demo', 1, 'operation_template_cleanup_create');
    if (!used.ok || typeof used.data.taskId !== 'string') throw new Error('expected template draft');
    expect(await harness.service.recycleTask(teacher, used.data.taskId,
      '清理虚构模板草稿', 1, 'operation_template_cleanup_recycle'))
      .toMatchObject({ ok: true, data: { visibility: 'recycled', version: 2 } });
    expect(harness.repository.debugSnapshot().tasks.find(task => task.id === used.data.taskId))
      .toMatchObject({ status: 'draft', visibility: 'recycled', targetClassIds: [] });
  });

  it('拒绝越权、下架及目标授权丢失，失败不增加模板使用次数', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalPayload,
      templates: [template('personal', 'teacher_other')] });
    expect(await harness.service.instantiateTemplate(teacher, 'template_demo', 1, 'operation_other_template'))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    await harness.repository.saveTemplate(template('system', null));
    harness.repository.upsertResource({ id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID,
      type: 'reading', title: '原绘本', contentVersion: 3, status: 'offline', visibility: 'classes',
      allowedClassIds: [CLASS_ID], payload: originalPayload });
    expect(await harness.service.instantiateTemplate(teacher, 'template_demo', 1, 'operation_offline_template'))
      .toMatchObject({ ok: false, error: { code: 'RESOURCE_OFFLINE' } });
    expect(harness.repository.debugSnapshot().templates[0]).toMatchObject({ useCount: 0, version: 1 });
    harness.repository.upsertResource({ id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID,
      type: 'reading', title: '原绘本', contentVersion: 3, status: 'published', visibility: 'classes',
      allowedClassIds: ['class_other'], payload: originalPayload });
    expect(await harness.service.instantiateTemplate(teacher, 'template_demo', 1, 'operation_denied_template'))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(harness.repository.debugSnapshot().templates[0]).toMatchObject({ useCount: 0, version: 1 });
  });

  it('审计写入失败时任务草稿和使用次数一起回滚', async () => {
    const harness = createHarness({ resourceType: 'reading', resourcePayload: originalPayload,
      templates: [template()] });
    harness.repository.failNext('audit.append');
    await expect(harness.service.instantiateTemplate(teacher, 'template_demo', 1,
      'operation_template_audit_rollback')).rejects.toThrow();
    expect(harness.repository.debugSnapshot().tasks).toHaveLength(0);
    expect(harness.repository.debugSnapshot().templates[0]).toMatchObject({ useCount: 0, version: 1 });
    expect(await harness.service.instantiateTemplate(teacher, 'template_demo', 1,
      'operation_template_audit_rollback')).toMatchObject({ ok: true, data: { version: 1 } });
    expect(harness.repository.debugSnapshot().templates[0]).toMatchObject({ useCount: 1, version: 2 });
  });
});

function createReviewQueryFromCore(harness: TestHarness, codec: BatchReviewPreviewCodec): ReviewQueryService {
  const snapshot = harness.repository.debugSnapshot();
  return new ReviewQueryService({
    repository: new InMemoryTaskQueryRepository({
      teacherGrants: snapshot.teacherGrants.map((grant) => ({
        id: grant._id,
        organizationId: grant.organizationId,
        teacherId: grant.teacherId,
        classId: grant.classId,
        className: '三年级 2 班',
        permissions: grant.permissions,
        status: grant.status,
      })),
      tasks: snapshot.tasks,
      assignments: snapshot.assignments,
      submissions: snapshot.submissions,
      feedback: snapshot.feedback,
    }),
    clock: { nowIso: (): string => '2026-09-16T02:00:00.000Z' },
    requestIds: { next: (): string => 'request_batch_preview' },
    cursorCodec: codec,
  });
}

describe('M1 本地任务持久化闭环', () => {
  it('按学员布置在发布瞬间重新解析有效班级并只冻结所选学员', async () => {
    const harness = createHarness({ studentCount: 2 });
    const selectedStudentId = 'user_student_demo_2';
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '指定学员虚构练习',
      itemRefs: [{
        id: 'item_exercise', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 }, order: 1,
      }],
      targetType: 'students',
      targetClassIds: [],
      targetStudentIds: [selectedStudentId],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_student_target');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const published = await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_student_target');
    expect(published).toMatchObject({ ok: true, data: { assignmentCount: 1 } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, draft.data.taskId)).toMatchObject({
      targetType: 'students', targetClassIds: [CLASS_ID], targetStudentIds: [selectedStudentId],
    });
    expect(await harness.repository.findAssignment(ORGANIZATION_ID, draft.data.taskId, selectedStudentId)).toMatchObject({ classId: CLASS_ID });
    expect(await harness.repository.findAssignment(ORGANIZATION_ID, draft.data.taskId, STUDENT_ID)).toBeNull();
  });

  it('按学员发布会拒绝已失效或存在歧义的当前班级关系且不产生半成品', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '关系复核虚构练习',
      itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: [STUDENT_ID],
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_student_membership_recheck');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    harness.repository.upsertMembership({
      id: 'membership_1', organizationId: ORGANIZATION_ID, classId: CLASS_ID, studentId: STUDENT_ID, status: 'inactive',
    });
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_student_membership_recheck')).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { targetStudentIds: expect.any(String) } },
    });
    expect(await harness.repository.findTask(ORGANIZATION_ID, draft.data.taskId)).toMatchObject({ status: 'draft', version: 1 });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(0);
  });

  it('未发布草稿可回收且不会生成学生任务', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '待回收虚构草稿', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_draft_for_recycle');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const result = await harness.service.recycleTask(teacher, draft.data.taskId, '教师删除未发布草稿', 1, 'operation_recycle_draft');
    expect(result).toMatchObject({ ok: true, data: { visibility: 'recycled', version: 2 } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(0);
  });

  it('已发布任务严格执行一次延期、开始前撤回和七天软回收并保持幂等审计', async () => {
    const activeHarness = createHarness();
    const activeTaskId = await publishSingleStudentTask(activeHarness);
    const extended = await activeHarness.service.updatePublishedTask(teacher, {
      taskId: activeTaskId,
      dueAt: '2026-09-18T12:00:00.000Z',
      description: '延期后的虚构说明',
    }, 2, 'operation_extend_once');
    expect(extended).toMatchObject({ ok: true, data: { status: 'active', version: 3, dueAt: '2026-09-18T12:00:00.000Z' } });
    expect(await activeHarness.service.updatePublishedTask(teacher, {
      taskId: activeTaskId,
      dueAt: '2026-09-18T12:00:00.000Z',
      description: '延期后的虚构说明',
    }, 2, 'operation_extend_once')).toEqual(extended);
    expect(await activeHarness.service.updatePublishedTask(teacher, {
      taskId: activeTaskId, dueAt: '2026-09-19T12:00:00.000Z',
    }, 3, 'operation_extend_twice')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await activeHarness.service.updatePublishedTask(teacher, {
      taskId: activeTaskId, title: '进行中不得改名',
    }, 3, 'operation_active_rename')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const recycled = await activeHarness.service.recycleTask(teacher, activeTaskId, '教师确认删除', 3, 'operation_recycle_task');
    expect(recycled).toMatchObject({
      ok: true,
      data: { visibility: 'recycled', version: 4, recoverableUntil: '2026-09-23T02:00:00.000Z' },
    });
    expect(await activeHarness.repository.findAssignment(ORGANIZATION_ID, activeTaskId, STUDENT_ID)).not.toBeNull();
    const activeSnapshot = activeHarness.repository.debugSnapshot();
    expect(activeSnapshot.operationLogs.filter((entry) => entry.action === 'task.updatePublished')).toHaveLength(1);
    expect(activeSnapshot.operationLogs.filter((entry) => entry.action === 'task.recycle')).toHaveLength(1);

    const scheduledHarness = createHarness();
    const draft = await scheduledHarness.service.saveTaskDraft(teacher, {
      title: '待开始虚构任务',
      itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_scheduled');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await scheduledHarness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_scheduled')).toMatchObject({ ok: true });
    expect(await scheduledHarness.service.updatePublishedTask(teacher, {
      taskId: draft.data.taskId, title: '待开始已更新任务', startsAt: '2026-09-16T04:00:00.000Z',
    }, 2, 'operation_update_scheduled')).toMatchObject({ ok: true, data: { status: 'scheduled', version: 3 } });
    const withdrawn = await scheduledHarness.service.withdrawTask(teacher, draft.data.taskId, '计划调整', 3, 'operation_withdraw_scheduled');
    expect(withdrawn).toMatchObject({ ok: true, data: { status: 'withdrawn', version: 4 } });
    expect(await scheduledHarness.service.updatePublishedTask(teacher, {
      taskId: draft.data.taskId, description: '撤回后不能编辑',
    }, 4, 'operation_update_withdrawn')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('生命周期命令的审计失败会连同任务版本、软回收和幂等记录一起回滚', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    harness.repository.failNext('audit.append');
    await expect(harness.service.recycleTask(
      teacher, taskId, '回滚验证', 2, 'operation_recycle_audit_failure',
    )).rejects.toThrow('simulated audit.append failure');
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({
      version: 2, visibility: 'visible', recycledAt: null, recoverableUntil: null,
    });
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_recycle_audit_failure')).toHaveLength(0);
    expect(snapshot.operationLogs.filter((entry) => entry.action === 'task.recycle')).toHaveLength(0);
  });

  it('待开始任务可同时更新内容与按学员对象，重建完整快照且不残留旧 assignment', async () => {
    const harness = createHarness({ studentCount: 2 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '待开始全量编辑任务',
      itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_scheduled_full_update');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    expect(await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_scheduled_full_update')).toMatchObject({
      ok: true, data: { assignmentCount: 2 },
    });
    harness.repository.upsertResource({
      id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID, type: 'exercise', title: '更新后的虚构练习',
      contentVersion: 4, status: 'published', visibility: 'classes', allowedClassIds: [CLASS_ID],
      payload: { promptKey: 'demo_animals_v4', points: 80 },
    });
    const selectedStudentId = 'user_student_demo_2';
    expect(await harness.service.updatePublishedTask(teacher, {
      taskId,
      title: '待开始全量编辑任务（新版）',
      itemRefs: [{
        id: 'item_exercise_v2', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 2 }, order: 1,
      }],
      targetType: 'students', targetClassIds: [], targetStudentIds: [selectedStudentId],
    }, 2, 'operation_update_scheduled_content_target')).toMatchObject({ ok: true, data: { version: 3 } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({
      title: '待开始全量编辑任务（新版）',
      targetType: 'students', targetClassIds: [CLASS_ID], targetStudentIds: [selectedStudentId],
      itemRefs: [{ id: 'item_exercise_v2' }],
      items: [{
        id: 'item_exercise_v2', resourceVersion: 4,
        resourceSnapshot: { title: '更新后的虚构练习', payload: { promptKey: 'demo_animals_v4', points: 80 } },
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 2 },
      }],
    });
    expect(await harness.repository.findAssignment(ORGANIZATION_ID, taskId, STUDENT_ID)).toBeNull();
    expect(await harness.repository.findAssignment(ORGANIZATION_ID, taskId, selectedStudentId)).toMatchObject({ classId: CLASS_ID });
    expect(harness.repository.debugSnapshot().assignments.filter((assignment) => assignment.taskId === taskId)).toHaveLength(1);
  });

  it('待开始任务可从按学员改为按班级并解析当前 active 学员重建 assignments', async () => {
    const harness = createHarness({ studentCount: 2 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '按班级更新任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: [STUDENT_ID],
      startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_classes_target_update');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_classes_target_update');
    expect(await harness.service.updatePublishedTask(teacher, {
      taskId, targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: [],
    }, 2, 'operation_update_to_classes')).toMatchObject({ ok: true, data: { version: 3 } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({
      targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: ['user_student_demo_2', STUDENT_ID],
    });
    expect(harness.repository.debugSnapshot().assignments.filter((assignment) => assignment.taskId === taskId)).toHaveLength(2);
  });

  it('按班级更新拒绝空班级且保持原任务对象不变', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '空班保护任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: [STUDENT_ID],
      startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_empty_class_guard');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_empty_class_guard');
    harness.repository.upsertMembership({
      id: 'membership_1', organizationId: ORGANIZATION_ID, classId: CLASS_ID, studentId: STUDENT_ID, status: 'inactive',
    });
    expect(await harness.service.updatePublishedTask(teacher, {
      taskId, targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: [],
    }, 2, 'operation_update_empty_class_guard')).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { target: expect.any(String) } },
    });
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({ version: 2, targetType: 'students', targetStudentIds: [STUDENT_ID] });
    expect(harness.repository.debugSnapshot().assignments.filter((assignment) => assignment.taskId === taskId)).toHaveLength(1);
  });

  it('按班级更新拒绝超过 50 名有效学员且不产生部分 assignment', async () => {
    const harness = createHarness({ studentCount: 51 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '班级人数上限任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: [STUDENT_ID],
      startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_class_limit_guard');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_class_limit_guard');
    expect(await harness.service.updatePublishedTask(teacher, {
      taskId, targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: [],
    }, 2, 'operation_update_class_limit_guard')).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { target: expect.any(String) } },
    });
    expect(harness.repository.debugSnapshot().assignments.filter((assignment) => assignment.taskId === taskId)).toHaveLength(1);
  });

  it('按班级更新在事务内重新校验教师授权，撤权后不改任务或 assignments', async () => {
    const harness = createHarness({ studentCount: 2 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '班级授权复核任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: [STUDENT_ID],
      startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_class_grant_guard');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_class_grant_guard');
    await harness.repository.commitTeacherGrant({ ...harness.teacherGrants[0], status: 'revoked', version: 2 });
    expect(await harness.service.updatePublishedTask(teacher, {
      taskId, targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: [],
    }, 2, 'operation_update_class_grant_guard')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({ version: 2, targetType: 'students' });
    expect(harness.repository.debugSnapshot().assignments.filter((assignment) => assignment.taskId === taskId)).toHaveLength(1);
  });

  it('待开始任务全量编辑在审计失败时原子恢复旧快照和全部旧 assignment', async () => {
    const harness = createHarness({ studentCount: 2 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '原子回滚任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_scheduled_atomic');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_scheduled_atomic');
    harness.repository.failNext('audit.append');
    await expect(harness.service.updatePublishedTask(teacher, {
      taskId,
      itemRefs: [{ id: 'item_new', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: ['user_student_demo_2'],
    }, 2, 'operation_update_scheduled_atomic_failure')).rejects.toThrow('simulated audit.append failure');
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({
      version: 2, targetType: 'classes', targetStudentIds: ['user_student_demo_2', STUDENT_ID], itemRefs: [{ id: 'item_exercise' }],
    });
    expect(harness.repository.debugSnapshot().assignments.filter((assignment) => assignment.taskId === taskId)).toHaveLength(2);
    expect(harness.repository.debugSnapshot().idempotencyRecords.filter((record) => record.operationId === 'operation_update_scheduled_atomic_failure')).toHaveLength(0);
  });

  it('待开始任务若异常存在提交记录则拒绝改内容或对象', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '异常提交保护任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T03:00:00.000Z', dueAt: '2026-09-17T03:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_scheduled_submission_guard');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_scheduled_submission_guard');
    const assignment = await harness.repository.findAssignment(ORGANIZATION_ID, taskId, STUDENT_ID);
    if (assignment === null) throw new Error('assignment expected');
    await harness.repository.saveSubmission({
      id: 'submission_unexpected', organizationId: ORGANIZATION_ID, taskId, assignmentId: assignment.id, studentId: STUDENT_ID,
      submissionVersion: 1, recordVersion: 1, status: 'draft', answers: [], isLate: false, submittedAt: null, supersedesSubmissionId: null,
    });
    expect(await harness.service.updatePublishedTask(teacher, {
      taskId, itemRefs: [{ id: 'item_new', resourceId: 'resource_demo_exercise', order: 1 }],
    }, 2, 'operation_update_scheduled_submission_guard')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({ version: 2, itemRefs: [{ id: 'item_exercise' }] });
  });

  it('发布时冻结目标学生名单与资源内容快照，后续源数据变化不回写历史任务', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);

    harness.repository.upsertResource({
      id: 'resource_demo_exercise',
      organizationId: ORGANIZATION_ID,
      type: 'exercise',
      title: '资源更新后的标题',
      contentVersion: 4,
      status: 'offline',
      visibility: 'classes',
      allowedClassIds: [CLASS_ID],
      payload: { promptKey: 'demo_animals_v4', points: 80 },
    });
    harness.repository.upsertMembership({
      id: 'membership_other',
      organizationId: ORGANIZATION_ID,
      classId: CLASS_ID,
      studentId: 'user_student_other',
      status: 'active',
    });

    const task = await harness.repository.findTask(ORGANIZATION_ID, taskId);
    expect(task).toMatchObject({
      targetStudentIds: [STUDENT_ID],
      items: [{
        resourceId: 'resource_demo_exercise',
        resourceVersion: 3,
        snapshotSchemaVersion: 1,
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        resourceSnapshot: { title: '动物主题虚构练习', payload: { promptKey: 'demo_animals_v3', points: 100 } },
      }],
    });
    expect(await harness.repository.findAssignment(ORGANIZATION_ID, taskId, 'user_student_other')).toBeNull();
  });

  it('发布前预检资源班级可见范围与全部 assignment 冲突，不提交半成品', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '发布预检演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_publish_precheck');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;

    harness.repository.upsertResource({
      id: 'resource_demo_exercise',
      organizationId: ORGANIZATION_ID,
      type: 'exercise',
      title: '其他班级可见资源',
      contentVersion: 3,
      status: 'published',
      visibility: 'classes',
      allowedClassIds: ['class_grade4_1'],
      payload: { promptKey: 'demo_other_class', points: 100 },
    });
    expect(await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_invisible_resource')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, taskId)).toMatchObject({ status: 'draft', version: 1 });

    harness.repository.upsertResource({
      id: 'resource_demo_exercise',
      organizationId: ORGANIZATION_ID,
      type: 'exercise',
      title: '动物主题虚构练习',
      contentVersion: 3,
      status: 'published',
      visibility: 'classes',
      allowedClassIds: [CLASS_ID],
      payload: { promptKey: 'demo_animals_v3', points: 100 },
    });
    await harness.repository.saveAssignment({
      id: `assignment_${taskId}_${STUDENT_ID}`,
      organizationId: ORGANIZATION_ID,
      taskId,
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      status: 'not_started',
      latestSubmissionId: null,
      latestSubmissionVersion: 0,
      redoCount: 0,
      redoDueAt: null,
      isLate: false,
      submittedAt: null,
      reviewedAt: null,
      version: 1,
    });
    expect(await harness.service.publishTask(teacher, taskId, 1, 'operation_publish_assignment_conflict')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.tasks).toEqual([expect.objectContaining({ id: taskId, status: 'draft', version: 1 })]);
    expect(snapshot.assignments).toHaveLength(1);
    expect(snapshot.submissions).toHaveLength(0);
  });

  it('发布资源要求 actor 与每个目标班级 grant 同时具备 content.read', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '内容权限演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_content_permission');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');

    const actorWithoutContent = { ...teacher, permissions: ['task.publish', 'submission.review'] };
    expect(await harness.service.publishTask(actorWithoutContent, draft.data.taskId, 1, 'operation_publish_actor_without_content')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    harness.teacherGrants[0] = { ...harness.teacherGrants[0], permissions: ['task.publish', 'submission.review'], version: 2 };
    await harness.repository.commitTeacherGrant(harness.teacherGrants[0]);
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_grant_without_content')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, draft.data.taskId)).toMatchObject({ status: 'draft', version: 1 });
  });

  it('500 人发布分批创建记录，完成前任务保持草稿，重复请求不会重复创建', async () => {
    const harness = createHarness({ studentCount: 500 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '发布规模上限演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_oversized_target');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    let result = await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_oversized_target');
    expect(result).toMatchObject({ ok: true, data: { status: 'publishing', assignmentCount: 60, totalCount: 500 } });
    expect(await harness.repository.findTask(ORGANIZATION_ID, draft.data.taskId)).toMatchObject({ status: 'draft' });
    for (let attempt = 0; attempt < 9 && result.ok && result.data.status === 'publishing'; attempt += 1) {
      result = await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_oversized_target');
    }
    expect(result).toMatchObject({ ok: true, data: { status: 'active', assignmentCount: 500 } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(500);
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_oversized_target')).toMatchObject({ ok: true, data: { assignmentCount: 500 } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(500);
  });

  it('发布目标超过 500 人时拒绝且不产生部分记录', async () => {
    const harness = createHarness({ studentCount: 501 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '超出上限的虚构任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_501_target');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_501_target')).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { targetClassIds: expect.stringContaining('500') } },
    });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(0);
  });

  it('服务端拒绝把 M3 视频资源伪装成习题规则发布', async () => {
    const harness = createHarness({ resourceType: 'video' as LearningResourceType });
    const saved = await harness.service.saveTaskDraft(teacher, {
      title: '伪造类型任务', itemRefs: [{ id: 'item_video', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100 }, order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_forged_video_save');
    if (!saved.ok) throw new Error('expected draft');
    expect(await harness.service.publishTask(teacher, saved.data.taskId as string, 1,
      'operation_forged_video_publish')).toMatchObject({ ok: false,
        error: { code: 'VALIDATION_ERROR' } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(0);
  });

  it('按学员选择超过 50 人时也能保存草稿并分批发布', async () => {
    const harness = createHarness({ studentCount: 68 });
    const studentIds = Array.from({ length: 68 }, (_, index) => index === 0 ? STUDENT_ID : `user_student_demo_${index + 1}`);
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '按学员发布的虚构任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetType: 'students', targetClassIds: [], targetStudentIds: studentIds,
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_68_students');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const first = await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_68_students');
    expect(first).toMatchObject({ ok: true, data: { status: 'publishing', assignmentCount: 60, totalCount: 68 } });
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_68_students')).toMatchObject({ ok: true, data: { assignmentCount: 68 } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(68);
  });

  it('分批期间班级成员变化不改写已经冻结的发布名单', async () => {
    const harness = createHarness({ studentCount: 68 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '冻结名单的虚构任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_frozen_roster');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_frozen_roster')).toMatchObject({ ok: true, data: { status: 'publishing', assignmentCount: 60 } });
    harness.repository.upsertMembership({ id: 'membership_68', organizationId: ORGANIZATION_ID, classId: CLASS_ID, studentId: 'user_student_demo_68', status: 'inactive' });
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_frozen_roster')).toMatchObject({ ok: true, data: { status: 'active', assignmentCount: 68 } });
  });

  it('500 人待开始任务可修改说明而不重建学生任务', async () => {
    const harness = createHarness({ studentCount: 500 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '待开始的虚构任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-17T00:00:00.000Z', dueAt: '2026-09-18T00:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_scheduled_500');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    let result = await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_scheduled_500');
    for (let attempt = 0; attempt < 9 && result.ok && result.data.status === 'publishing'; attempt += 1) {
      result = await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_scheduled_500');
    }
    if (!result.ok || typeof result.data.version !== 'number') throw new Error('publish expected');
    const updated = await harness.service.updatePublishedTask(teacher, {
      taskId: draft.data.taskId, targetType: 'classes', targetClassIds: [CLASS_ID], targetStudentIds: [], description: '更新完成要求',
    }, result.data.version, 'operation_update_scheduled_500');
    expect(updated).toMatchObject({ ok: true });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(500);
  });

  it('最后一批审计写入失败时保持不可见，重试后完整发布', async () => {
    const harness = createHarness({ studentCount: 68 });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '可恢复的虚构任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise', order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_recoverable_68');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_recoverable_68')).toMatchObject({ ok: true, data: { status: 'publishing', assignmentCount: 60 } });
    harness.repository.failNext('audit.append');
    await expect(harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_recoverable_68')).rejects.toThrow();
    expect(await harness.repository.findTask(ORGANIZATION_ID, draft.data.taskId)).toMatchObject({ status: 'draft', publication: { nextIndex: 60 } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(60);
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_recoverable_68')).toMatchObject({ ok: true, data: { status: 'active', assignmentCount: 68 } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(68);
  });

  it('草稿可乐观锁更新，正式提交后答案不可修改；同幂等键重放返回同一提交', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    const staleDraft = await harness.service.saveSubmissionDraft(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: 'stale-answer' }],
      99,
      undefined,
      'operation_save_submission_stale',
    );
    expect(staleDraft).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const draft = await harness.service.saveSubmissionDraft(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: 'draft-answer' }],
      1,
      undefined,
      'operation_save_submission_0001',
    );
    expect(draft).toMatchObject({ ok: true, data: { submissionVersion: 1, recordVersion: 1, assignmentVersion: 2, status: 'draft' } });

    const submitted = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('final-answer') }],
      2,
      1,
      'operation_submit_0001',
    );
    expect(submitted).toMatchObject({ ok: true, data: { submissionVersion: 1, recordVersion: 2, assignmentVersion: 3, status: 'submitted' } });
    const replay = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('final-answer') }],
      2,
      1,
      'operation_submit_0001',
    );
    expect(replay).toEqual(submitted);
    const changedReplay = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: 'changed-answer' }],
      2,
      1,
      'operation_submit_0001',
    );
    expect(changedReplay).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');
    const frozen = await harness.repository.findSubmission(ORGANIZATION_ID, submitted.data.submissionId);
    expect(frozen?.answers).toEqual([{ itemId: 'item_exercise', value: exerciseResult('final-answer') }]);
    const attemptedEdit = await harness.service.saveSubmissionDraft(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: 'illegal-edit' }],
      3,
      undefined,
      'operation_save_submission_after_submit',
    );
    expect(attemptedEdit).toMatchObject({ ok: false, error: { code: 'TASK_NOT_SUBMITTABLE' } });
  });

  it('串行化并发提交：相同 expectedVersion 只有一个成功且不产生重复 assignment/submission', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    const [first, second] = await Promise.all([
      harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('concurrent-a') }], 1, undefined, 'operation_concurrent_submit_a'),
      harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('concurrent-b') }], 1, undefined, 'operation_concurrent_submit_b'),
    ]);
    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error.code === 'CONFLICT')).toHaveLength(1);
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.assignments).toHaveLength(1);
    expect(snapshot.assignments[0]).toMatchObject({ latestSubmissionVersion: 1, version: 2, status: 'awaiting_review' });
    expect(snapshot.submissions).toHaveLength(1);
    expect(snapshot.submissions[0]).toMatchObject({ submissionVersion: 1, status: 'submitted' });
  });

  it('正式提交拒绝 null 与空字符串答案，失败不推进 assignment 版本', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    expect(await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: null }], 1, undefined, 'operation_submit_null')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: '   ' }], 1, undefined, 'operation_submit_blank')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.assignments).toEqual([expect.objectContaining({ version: 1, status: 'not_started' })]);
    expect(snapshot.submissions).toHaveLength(0);
  });

  it('freezes a selected reading range and accepts only matching page events after publication', async () => {
    const payload = { chapters: [{ id: 'chapter_demo', pages: [
      { id: 'page_1' }, { id: 'page_2' }, { id: 'page_3' },
    ] }] };
    let now = '2026-09-16T02:00:00.000Z';
    const event = (pageId: string): ReadingPageEventRecord => ({ id: `visit_${pageId}`,
      organizationId: ORGANIZATION_ID, studentId: STUDENT_ID, resourceId: 'resource_demo_exercise',
      chapterId: 'chapter_demo', pageId, pageNumber: Number(pageId.slice(-1)), progressVersion: 1,
      contentVersion: '3', operationId: `operation_${pageId}`, visitedAt: '2026-09-16T03:00:00.000Z' });
    const reading = createHarness({ resourceType: 'reading', resourcePayload: payload,
      readingPageEvents: [event('page_1'), event('page_2')], nowIso: () => now });
    const rule = { kind: 'reading_pages', requiredPageCount: 2, pageIds: ['page_2', 'page_3'] };
    const taskId = await publishSingleStudentTask(reading, rule);
    now = '2026-09-16T04:00:00.000Z';
    expect(await reading.service.submit(student, taskId, [{ itemId: 'item_exercise',
      value: { kind: 'reading', completedPageCount: 2 } }], 1, undefined, 'operation_reading_wrong_pages'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    let completeNow = '2026-09-16T02:00:00.000Z';
    const complete = createHarness({ resourceType: 'reading', resourcePayload: payload,
      readingPageEvents: [event('page_2'), event('page_3')], nowIso: () => completeNow });
    const completeTaskId = await publishSingleStudentTask(complete, rule);
    completeNow = '2026-09-16T04:00:00.000Z';
    const completedReading = await complete.service.submit(student, completeTaskId, [{ itemId: 'item_exercise',
      value: { kind: 'reading', completedPageCount: 2 } }], 1, undefined, 'operation_reading_selected_pages');
    expect(completedReading).toMatchObject({ ok: true });
    expect(complete.repository.debugSnapshot().submissions[0]?.answers[0]?.value).toMatchObject({
      kind: 'reading', completedPageCount: 2,
      verifiedPageEvents: [{ pageId: 'page_2', visitedAt: '2026-09-16T03:00:00.000Z' },
        { pageId: 'page_3', visitedAt: '2026-09-16T03:00:00.000Z' }],
    });
    if (!completedReading.ok || typeof completedReading.data.submissionId !== 'string') throw new Error('reading submission expected');
    completeNow = '2026-09-16T05:00:00.000Z';
    expect(await complete.service.publishReview(teacher, { submissionId: completedReading.data.submissionId,
      decision: 'returned', score: 100, returnReason: '请重新阅读指定页', expectedSubmissionVersion: 1,
    }, 2, 'operation_reading_return')).toMatchObject({ ok: true });
    expect(await complete.service.submit(student, completeTaskId, [{ itemId: 'item_exercise',
      value: { kind: 'reading', completedPageCount: 2 } }], 3, undefined, 'operation_reading_resubmit_old_visits'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const invalid = createHarness({ resourceType: 'reading', resourcePayload: payload });
    const invalidDraft = await invalid.service.saveTaskDraft(teacher, { title: '无效页范围',
      itemRefs: [{ id: 'item_reading', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'reading_pages', requiredPageCount: 1, pageIds: ['missing_page'] }, order: 1 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 } }, 0, 'operation_invalid_reading_range');
    expect(invalidDraft.ok).toBe(true);
    if (!invalidDraft.ok || typeof invalidDraft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await invalid.service.publishTask(teacher, invalidDraft.data.taskId, 1, 'operation_publish_invalid_range'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('reading/vocabulary/exercise 使用服务端快照中的结构化完成规则判定提交', async () => {
    const reading = createHarness({ resourceType: 'reading' });
    const readingTaskId = await publishSingleStudentTask(reading, { kind: 'reading_pages', requiredPageCount: 3 });
    expect(await reading.service.submit(student, readingTaskId, [{
      itemId: 'item_exercise', value: { kind: 'reading', completedPageCount: 2 },
    }], 1, undefined, 'operation_reading_incomplete')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await reading.service.submit(student, readingTaskId, [{
      itemId: 'item_exercise', value: { kind: 'reading', completedPageCount: 4 },
    }], 1, undefined, 'operation_reading_overstated')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await reading.service.submit(student, readingTaskId, [{
      itemId: 'item_exercise', value: { kind: 'reading', completedPageCount: 3 },
    }], 1, undefined, 'operation_reading_complete')).toMatchObject({ ok: true });

    const vocabulary = createHarness({ resourceType: 'vocabulary' });
    const vocabularyTaskId = await publishSingleStudentTask(vocabulary, { kind: 'vocabulary_words', requiredWordCount: 5 });
    expect(await vocabulary.service.submit(student, vocabularyTaskId, [{
      itemId: 'item_exercise', value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 6 },
    }], 1, undefined, 'operation_vocabulary_invalid')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await vocabulary.service.submit(student, vocabularyTaskId, [{
      itemId: 'item_exercise', value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 3 },
    }], 1, undefined, 'operation_vocabulary_overstated')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await vocabulary.service.submit(student, vocabularyTaskId, [{
      itemId: 'item_exercise', value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 4 },
    }], 1, undefined, 'operation_vocabulary_complete')).toMatchObject({ ok: true });

    const exercise = createHarness();
    const exerciseTaskId = await publishSingleStudentTask(exercise, { kind: 'exercise_questions', requiredQuestionCount: 2 });
    expect(await exercise.service.submit(student, exerciseTaskId, [{
      itemId: 'item_exercise', value: { arbitrary: 'non-empty-json' },
    }], 1, undefined, 'operation_exercise_arbitrary')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await exercise.service.submit(student, exerciseTaskId, [{
      itemId: 'item_exercise', value: { kind: 'exercise', answeredQuestionCount: 2 },
    }], 1, undefined, 'operation_exercise_complete')).toMatchObject({ ok: true });
  });

  it('录音任务只有本人当前轮次的服务端封存文件能提交，并须教师评分后向家长展示反馈', async () => {
    const harness = createHarness({ resourceType: 'recording', resourcePayload: {
      promptKind: 'text', promptText: '请朗读虚构句子：The cat is happy.', requiresVideo: false,
    } });
    const taskId = await publishSingleStudentTask(harness, { kind: 'recording_upload' });
    const snapshot = harness.repository.debugSnapshot();
    const assignment = snapshot.assignments[0]!;
    const frozen = snapshot.tasks[0]!.items[0]!;
    const recording: TaskRecordingRecord = { id: 'task_recording_demo_1', organizationId: ORGANIZATION_ID,
      taskId, itemId: frozen.id, assignmentId: assignment.id, submissionVersion: 1,
      studentId: STUDENT_ID, classId: CLASS_ID, resourceVersion: frozen.resourceVersion,
      stagingPath: 'task-recordings/staging/demo/task_recording_demo_1.mp3',
      status: 'submitted', fileId: 'cloud://virtual-env/task-recordings/private/demo.mp3',
      contentSha256: 'a'.repeat(64), sizeBytes: 12000, durationMs: 3200,
      version: 2, createdAt: '2026-09-16T01:00:00.000Z', submittedAt: '2026-09-16T01:01:00.000Z' };
    expect(await harness.service.submit(student, taskId, [{ itemId: frozen.id,
      value: { kind: 'recording', recordingId: recording.id } }], 1, undefined, 'operation_recording_without_seal'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    harness.repository.seedTaskRecordings([{ ...recording, studentId: 'student_other' }]);
    expect(await harness.service.submit(student, taskId, [{ itemId: frozen.id,
      value: { kind: 'recording', recordingId: recording.id } }], 1, undefined, 'operation_recording_other_owner'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    harness.repository.seedTaskRecordings([recording]);
    const submitted = await harness.service.submit(student, taskId, [{ itemId: frozen.id,
      value: { kind: 'recording', recordingId: recording.id } }], 1, undefined, 'operation_recording_verified');
    expect(submitted).toMatchObject({ ok: true });
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');
    expect(harness.repository.debugSnapshot().submissions[0]?.answers[0]?.value)
      .toMatchObject({ kind: 'recording', recordingId: recording.id, durationMs: 3200, sizeBytes: 12000 });
    expect(await harness.service.publishReview(teacher, { submissionId: submitted.data.submissionId,
      decision: 'approved', textComment: '朗读已收到。', expectedSubmissionVersion: 1 }, 2,
    'operation_recording_unscored')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await harness.service.publishReview(teacher, { submissionId: submitted.data.submissionId,
      decision: 'approved', itemScores: [{ itemId: frozen.id, score: 88 }],
      textComment: '朗读清晰。', expectedSubmissionVersion: 1 }, 2,
    'operation_recording_scored')).toMatchObject({ ok: true });
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId))
      .toMatchObject({ ok: true, data: { feedback: { score: 88 } } });
  });

  it('combines an automatic reading item with a teacher-scored recording using the frozen weights', async () => {
    const harness = createHarness({ resourceType: 'reading' });
    harness.repository.upsertResource({ id: 'recording_prompt_demo', organizationId: ORGANIZATION_ID,
      type: 'recording', title: '虚构录音提示', contentVersion: 1, status: 'published',
      visibility: 'classes', allowedClassIds: [CLASS_ID],
      payload: { promptKind: 'text', promptText: 'Read the sentence.', requiresVideo: false } });
    const draft = await harness.service.saveTaskDraft(teacher, { title: '阅读加录音',
      itemRefs: [{ id: 'item_read', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'reading_pages', requiredPageCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 25 }, order: 1 },
      { id: 'item_record', resourceId: 'recording_prompt_demo',
        completionRule: { kind: 'recording_upload' },
        scoringRule: { kind: 'manual', maxScore: 100, weightPercent: 75 }, order: 2 }],
      targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 } },
    0, 'operation_mixed_recording_draft');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    expect(await harness.service.publishTask(teacher, taskId, 1, 'operation_mixed_recording_publish'))
      .toMatchObject({ ok: true });
    const assignment = harness.repository.debugSnapshot().assignments[0]!;
    harness.repository.seedTaskRecordings([{ id: 'recording_mixed_demo', organizationId: ORGANIZATION_ID,
      taskId, itemId: 'item_record', assignmentId: assignment.id, submissionVersion: 1,
      studentId: STUDENT_ID, classId: CLASS_ID, resourceVersion: 1, stagingPath: 'virtual',
      status: 'submitted', fileId: 'cloud://virtual/private.mp3', contentSha256: 'a'.repeat(64),
      sizeBytes: 12000, durationMs: 3200, version: 2,
      createdAt: '2026-09-16T01:00:00.000Z', submittedAt: '2026-09-16T01:01:00.000Z' }]);
    const submitted = await harness.service.submit(student, taskId, [
      { itemId: 'item_read', value: { kind: 'reading', completedPageCount: 1 } },
      { itemId: 'item_record', value: { kind: 'recording', recordingId: 'recording_mixed_demo' } },
    ], 1, undefined, 'operation_mixed_recording_submit');
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');
    expect(await harness.service.publishReview(teacher, { submissionId: submitted.data.submissionId,
      expectedSubmissionVersion: 1, decision: 'approved',
      itemScores: [{ itemId: 'item_record', score: 60 }], textComment: '虚构点评' },
    2, 'operation_mixed_recording_review')).toMatchObject({ ok: true });
    expect(harness.repository.debugSnapshot().feedback).toMatchObject([{ score: 70,
      itemScores: [{ itemId: 'item_record', score: 60 }] }]);
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId))
      .toMatchObject({ ok: true, data: { feedback: { score: 70 } } });
  });

  it('拒绝仅靠客户端数字声称已完成阅读或单词练习', async () => {
    const reading = createHarness({ resourceType: 'reading', withLearningProgress: false });
    const readingTaskId = await publishSingleStudentTask(reading, { kind: 'reading_pages', requiredPageCount: 3 });
    expect(await reading.service.submit(student, readingTaskId, [{ itemId: 'item_exercise', value: { kind: 'reading', completedPageCount: 3 } }], 1, undefined, 'operation_reading_forged'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const vocabulary = createHarness({ resourceType: 'vocabulary', withLearningProgress: false });
    const vocabularyTaskId = await publishSingleStudentTask(vocabulary, { kind: 'vocabulary_words', requiredWordCount: 5 });
    expect(await vocabulary.service.submit(student, vocabularyTaskId, [{ itemId: 'item_exercise', value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 4 } }], 1, undefined, 'operation_vocabulary_forged'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('新词包任务只接受同一任务轮次的逐词首次作答，重练不改写首次正确率', async () => {
    const vocabulary = createHarness({ resourceType: 'vocabulary', resourcePayload: { grade: '三年级', unit: 'Unit 3', words: [
      { id: 'word_1', word: 'tiger', meaning: '老虎', syllables: ['ti', 'ger'] },
      { id: 'word_2', word: 'lion', meaning: '狮子', syllables: ['li', 'on'] },
      { id: 'word_3', word: 'bear', meaning: '熊', syllables: ['bear'] },
      { id: 'word_4', word: 'bird', meaning: '鸟', syllables: ['bird'] },
      { id: 'word_5', word: 'fish', meaning: '鱼', syllables: ['fish'] },
    ] } });
    const taskId = await publishSingleStudentTask(vocabulary, { kind: 'vocabulary_words', requiredWordCount: 5 });
    expect(vocabulary.repository.debugSnapshot().tasks[0]?.items[0]?.snapshotSchemaVersion).toBe(2);
    expect(await vocabulary.service.submit(student, taskId, [{ itemId: 'item_exercise',
      value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 4 } }], 1, undefined, 'operation_vocabulary_legacy_count'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const words = ['word_1', 'word_2', 'word_3', 'word_4', 'word_5'];
    vocabulary.repository.seedVocabularyAttempts([
      ...words.map((wordId, index) => ({ id: `attempt_${index + 1}`, organizationId: ORGANIZATION_ID,
        studentId: STUDENT_ID, packId: 'resource_demo_exercise', taskId, itemId: 'item_exercise', round: 1,
        contentVersion: '3', wordId, studentInput: index === 0 ? 'wrong' : 'correct', isCorrect: index !== 0,
        firstAttempt: true, attemptNumber: 1, attemptedAt: '2026-09-16T01:00:00.000Z' })),
      { id: 'attempt_retry', organizationId: ORGANIZATION_ID, studentId: STUDENT_ID,
        packId: 'resource_demo_exercise', taskId, itemId: 'item_exercise', round: 1,
        contentVersion: '3', wordId: 'word_1', studentInput: 'tiger', isCorrect: true,
        firstAttempt: false, attemptNumber: 2, attemptedAt: '2026-09-16T01:01:00.000Z' },
    ]);
    expect(await vocabulary.service.submit(student, taskId, [{ itemId: 'item_exercise',
      value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 5 } }], 1, undefined, 'operation_vocabulary_forged_score'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await vocabulary.service.submit(student, taskId, [{ itemId: 'item_exercise',
      value: { kind: 'vocabulary', completedWordCount: 5, correctWordCount: 4 } }], 1, undefined, 'operation_vocabulary_verified'))
      .toMatchObject({ ok: true });
  });

  it('限制任务说明、教师备注、点评和退回原因长度', async () => {
    const harness = createHarness();
    expect(await harness.service.saveTaskDraft(teacher, {
      title: '字段长度演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
      description: '说'.repeat(301),
      teacherNote: '注'.repeat(101),
    }, 0, 'operation_save_overlong_fields')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { description: expect.any(String), teacherNote: expect.any(String) } },
    });

    const taskId = await publishSingleStudentTask(harness);
    const submitted = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('review-length') }], 1, undefined, 'operation_submit_review_length');
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'approved',
      textComment: '评'.repeat(501),
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_overlong_comment')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { textComment: expect.any(String) } } });
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'returned',
      returnReason: '退'.repeat(201),
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_overlong_reason')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { returnReason: expect.any(String) } } });
  });

  it('人工评分精确绑定提交版本且每版本至多一个反馈，家长只能读取已绑定孩子结果', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    const submitted = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('answer-v1') }],
      1,
      undefined,
      'operation_submit_reviewable',
    );
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');
    const submissionId = submitted.data.submissionId;
    const staleReview = await harness.service.publishReview(teacher, {
      submissionId,
      decision: 'approved',
      score: 92,
      expectedSubmissionVersion: 2,
    }, 2, 'operation_review_stale_submission');
    expect(staleReview).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const reviewed = await harness.service.publishReview(teacher, {
      submissionId,
      decision: 'approved',
      score: 92,
      textComment: '完成认真，继续保持。',
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_approved');
    expect(reviewed).toMatchObject({ ok: true, data: { submissionVersion: 1, decision: 'approved', assignmentVersion: 3 } });

    const duplicate = await harness.service.publishReview(teacher, {
      submissionId,
      decision: 'approved',
      score: 96,
      expectedSubmissionVersion: 1,
    }, 3, 'operation_review_duplicate');
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    const parentView = await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId);
    expect(parentView).toMatchObject({
      ok: true,
      data: {
        title: '动物主题听说练习',
        assignmentStatus: 'completed',
        submission: { id: submissionId, version: 1, answers: [{ itemId: 'item_exercise', value: exerciseResult('answer-v1') }] },
        feedback: { decision: 'approved', score: 92, textComment: '完成认真，继续保持。' },
      },
    });
    if (parentView.ok) expect(parentView.data).not.toHaveProperty('teacherNote');
  });

  it('批量点评只写入预览时实际符合条件的提交，并保持幂等、原子审计且不覆盖已有点评', async () => {
    let tokenSequence = 0;
    const codec = new InMemoryOpaqueCursorCodec({ next: (): string => `batch_token_${++tokenSequence}` });
    const harness = createHarness({ studentCount: 3, batchReviewPreviewCodec: codec,
      resourcePayload: BATCH_OBJECTIVE_PAYLOAD });
    const taskId = await publishSingleStudentTask(harness,
      { kind: 'exercise_questions', requiredQuestionCount: 1 }, { kind: 'automatic', maxScore: 100 });
    const student2 = { ...student, actorUserId: 'user_student_demo_2', scopeIds: ['user_student_demo_2'] };
    const submitted1 = await harness.service.submit(
      student, taskId, [{ itemId: 'item_exercise', value: batchObjectiveAnswer('giraffe') }],
      1, undefined, 'operation_batch_submit_1',
    );
    const submitted2 = await harness.service.submit(
      student2, taskId, [{ itemId: 'item_exercise', value: batchObjectiveAnswer('elephant') }],
      1, undefined, 'operation_batch_submit_2',
    );
    if (!submitted1.ok || typeof submitted1.data.submissionId !== 'string'
      || !submitted2.ok || typeof submitted2.data.submissionId !== 'string') throw new Error('submissions expected');
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitted2.data.submissionId,
      decision: 'approved',
      textComment: '已有点评不得覆盖。',
      expectedSubmissionVersion: 1,
    }, 2, 'operation_existing_review')).toMatchObject({ ok: true });

    const preview = await createReviewQueryFromCore(harness, codec).previewBatchComment(
      teacher,
      taskId,
      {},
      { mode: 'eligible', submissionIds: [] },
      '统一人工点评',
    );
    expect(preview).toMatchObject({ ok: true, data: { eligibleCount: 1, excludedCount: 2 } });
    if (!preview.ok) throw new Error('preview expected');
    const publish = () => harness.service.publishBatchComment(
      teacher,
      preview.data.previewToken,
      preview.data.previewVersion,
      '统一人工点评',
      'operation_publish_batch_comment',
    );
    const first = await publish();
    const repeated = await publish();
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      ok: true,
      data: { reviewedCount: 1, submissionIds: [submitted1.data.submissionId] },
    });

    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toHaveLength(2);
    expect(snapshot.feedback.find((item) => item.submissionId === submitted1.data.submissionId)).toMatchObject({
      textComment: '统一人工点评', decision: 'approved', score: null,
    });
    expect(snapshot.feedback.find((item) => item.submissionId === submitted2.data.submissionId)).toMatchObject({
      textComment: '已有点评不得覆盖。',
    });
    expect(snapshot.assignments.find((item) => item.studentId === 'user_student_demo_3')).toMatchObject({
      status: 'not_started', reviewedAt: null, version: 1,
    });
    expect(snapshot.operationLogs.filter((entry) => entry.action === 'submission.batch_comment')).toEqual([
      expect.objectContaining({ targetId: taskId, result: 'succeeded', metadata: expect.objectContaining({ reviewedCount: 1 }) }),
    ]);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_publish_batch_comment')).toHaveLength(1);
  });

  it('批量评语排除旧式及主观题人工评分提交，不能绕过逐项评分', async () => {
    const subjectivePayload: JsonObject = { questionIds: ['resource_demo_exercise'], questionType: 'subjective',
      stem: '请解释虚构答案', options: [], correctAnswer: 'giraffe', explanation: '虚构题解析' };
    for (const [index, payload] of [undefined, subjectivePayload].entries()) {
      const codec = new InMemoryOpaqueCursorCodec({ next: (): string => `batch_manual_${index}` });
      const harness = createHarness({ batchReviewPreviewCodec: codec,
        ...(payload === undefined ? {} : { resourcePayload: payload }) });
      const taskId = await publishSingleStudentTask(harness);
      const submitted = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise',
        value: payload === undefined ? exerciseResult('legacy-manual') : batchObjectiveAnswer('giraffe') }],
      1, undefined, `operation_batch_manual_submit_${index}`);
      expect(submitted).toMatchObject({ ok: true });
      const preview = await createReviewQueryFromCore(harness, codec).previewBatchComment(
        teacher, taskId, {}, { mode: 'eligible', submissionIds: [] }, '不应批量发布的评语',
      );
      expect(preview).toMatchObject({ ok: true, data: { eligibleCount: 0, excludedCount: 1 } });
      if (!preview.ok) throw new Error('preview expected');
      expect(await harness.service.publishBatchComment(teacher, preview.data.previewToken,
        preview.data.previewVersion, '不应批量发布的评语', `operation_batch_manual_publish_${index}`))
        .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(harness.repository.debugSnapshot().feedback).toHaveLength(0);
    }
  });

  it('批量点评发布时重新复核权限和 eligible 集合，预览过期状态变化后不执行部分写入', async () => {
    let tokenSequence = 0;
    const codec = new InMemoryOpaqueCursorCodec({ next: (): string => `batch_guard_${++tokenSequence}` });
    const harness = createHarness({ batchReviewPreviewCodec: codec,
      resourcePayload: BATCH_OBJECTIVE_PAYLOAD });
    const taskId = await publishSingleStudentTask(harness,
      { kind: 'exercise_questions', requiredQuestionCount: 1 }, { kind: 'automatic', maxScore: 100 });
    const submitted = await harness.service.submit(
      student, taskId, [{ itemId: 'item_exercise', value: batchObjectiveAnswer('giraffe') }],
      1, undefined, 'operation_batch_guard_submit',
    );
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');
    const preview = await createReviewQueryFromCore(harness, codec).previewBatchComment(
      teacher, taskId, {}, { mode: 'eligible', submissionIds: [] }, '不得越权发布',
    );
    if (!preview.ok) throw new Error('preview expected');

    expect(await harness.service.publishBatchComment(
      teacher,
      preview.data.previewToken,
      preview.data.previewVersion,
      '篡改后的点评',
      'operation_batch_tampered_comment',
    )).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await harness.service.publishBatchComment(
      { ...teacher, scopeIds: [] },
      preview.data.previewToken,
      preview.data.previewVersion,
      '不得越权发布',
      'operation_batch_without_scope',
    )).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(harness.repository.debugSnapshot().feedback).toHaveLength(0);

    expect(await harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'approved',
      textComment: '单条点评先提交。',
      expectedSubmissionVersion: 1,
    }, 2, 'operation_single_review_after_preview')).toMatchObject({ ok: true });
    expect(await harness.service.publishBatchComment(
      teacher,
      preview.data.previewToken,
      preview.data.previewVersion,
      '不得越权发布',
      'operation_stale_batch_preview',
    )).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toEqual([expect.objectContaining({ textComment: '单条点评先提交。' })]);
    expect(snapshot.operationLogs.filter((entry) => entry.action === 'submission.batch_comment')).toHaveLength(0);
  });

  it('批量点评审计失败会回滚全部反馈、状态和幂等记录，随后可安全重试', async () => {
    let tokenSequence = 0;
    const codec = new InMemoryOpaqueCursorCodec({ next: (): string => `batch_atomic_${++tokenSequence}` });
    const harness = createHarness({ studentCount: 2, batchReviewPreviewCodec: codec,
      resourcePayload: BATCH_OBJECTIVE_PAYLOAD });
    const taskId = await publishSingleStudentTask(harness,
      { kind: 'exercise_questions', requiredQuestionCount: 1 }, { kind: 'automatic', maxScore: 100 });
    for (const [index, actor] of [student, { ...student, actorUserId: 'user_student_demo_2', scopeIds: ['user_student_demo_2'] }].entries()) {
      expect(await harness.service.submit(
        actor,
        taskId,
        [{ itemId: 'item_exercise', value: batchObjectiveAnswer(index === 0 ? 'giraffe' : 'elephant') }],
        1,
        undefined,
        `operation_batch_atomic_submit_${index + 1}`,
      )).toMatchObject({ ok: true });
    }
    const preview = await createReviewQueryFromCore(harness, codec).previewBatchComment(
      teacher, taskId, {}, { mode: 'eligible', submissionIds: [] }, '事务内统一点评',
    );
    if (!preview.ok) throw new Error('preview expected');

    harness.repository.failNext('audit.append');
    await expect(harness.service.publishBatchComment(
      teacher, preview.data.previewToken, preview.data.previewVersion, '事务内统一点评', 'operation_batch_atomic_publish',
    )).rejects.toThrow('simulated audit.append failure');
    let snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toHaveLength(0);
    expect(snapshot.submissions.every((item) => item.status === 'submitted')).toBe(true);
    expect(snapshot.assignments.every((item) => item.status === 'awaiting_review' && item.version === 2)).toBe(true);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_batch_atomic_publish')).toHaveLength(0);

    expect(await harness.service.publishBatchComment(
      teacher, preview.data.previewToken, preview.data.previewVersion, '事务内统一点评', 'operation_batch_atomic_publish',
    )).toMatchObject({ ok: true, data: { reviewedCount: 2 } });
    snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toHaveLength(2);
    expect(snapshot.assignments.every((item) => item.status === 'completed' && item.version === 3)).toBe(true);
  });

  it('退回原因必填、最多退回两次，并为每次重做创建递增且不可覆盖的提交版本', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    const submitV1 = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('answer-v1') }], 1, undefined, 'operation_submit_v1');
    if (!submitV1.ok || typeof submitV1.data.submissionId !== 'string') throw new Error('v1 expected');
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitV1.data.submissionId,
      decision: 'returned',
      expectedSubmissionVersion: 1,
    }, 2, 'operation_return_without_reason')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { returnReason: expect.any(String) } } });
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitV1.data.submissionId, decision: 'returned', returnReason: '请订正',
      expectedSubmissionVersion: 1,
    }, 2, 'operation_return_without_score')).toMatchObject({ ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { score: expect.any(String) } } });
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitV1.data.submissionId,
      decision: 'returned',
      returnReason: '请补全第一项。',
      score: 0,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_return_v1')).toMatchObject({ ok: true, data: { submissionVersion: 1, assignmentVersion: 3 } });

    expect(await harness.service.submit(student, taskId, [{ itemId: 'item_exercise',
      value: exerciseResult('answer-v1') }], 3, undefined, 'operation_resubmit_unchanged')).toMatchObject({
      ok: false, error: { code: 'VALIDATION_ERROR' },
    });

    const submitV2 = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('answer-v2') }], 3, undefined, 'operation_submit_v2');
    expect(submitV2).toMatchObject({ ok: true, data: { submissionVersion: 2, assignmentVersion: 4 } });
    if (!submitV2.ok || typeof submitV2.data.submissionId !== 'string') throw new Error('v2 expected');
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitV2.data.submissionId,
      decision: 'returned',
      returnReason: '请再次检查。',
      score: 0,
      expectedSubmissionVersion: 2,
    }, 4, 'operation_return_v2')).toMatchObject({ ok: true, data: { submissionVersion: 2, assignmentVersion: 5 } });

    const submitV3 = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('answer-v3') }], 5, undefined, 'operation_submit_v3');
    expect(submitV3).toMatchObject({ ok: true, data: { submissionVersion: 3, assignmentVersion: 6 } });
    if (!submitV3.ok || typeof submitV3.data.submissionId !== 'string') throw new Error('v3 expected');
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitV3.data.submissionId,
      decision: 'returned',
      returnReason: '不应允许第三次退回。',
      score: 0,
      expectedSubmissionVersion: 3,
    }, 6, 'operation_return_v3')).toMatchObject({ ok: false, error: { code: 'REDO_LIMIT_REACHED' } });
    expect(await harness.repository.findFeedbackBySubmission(ORGANIZATION_ID, submitV3.data.submissionId)).toBeNull();
  });

  it('退回重做保存草稿后仍可在三天重做期内提交，即使原任务补交期已结束', async () => {
    let now = '2026-09-16T02:00:00.000Z';
    const harness = createHarness({ nowIso: () => now });
    const taskId = await publishSingleStudentTask(harness);
    const first = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('first') }], 1, undefined, 'operation_redo_draft_first');
    if (!first.ok || typeof first.data.submissionId !== 'string') throw new Error('first submission expected');

    now = '2026-09-24T02:00:00.000Z';
    expect(await harness.service.publishReview(teacher, {
      submissionId: first.data.submissionId, decision: 'returned', returnReason: '请订正后重交', score: 0,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_redo_draft_return')).toMatchObject({ ok: true, data: { assignmentVersion: 3 } });

    const draft = await harness.service.saveSubmissionDraft(student, taskId, [{ itemId: 'item_exercise', value: '订正草稿' }], 3, undefined, 'operation_redo_draft_save');
    expect(draft).toMatchObject({ ok: true, data: { submissionVersion: 2, recordVersion: 1, assignmentVersion: 4 } });
    expect(harness.repository.debugSnapshot().assignments[0]).toMatchObject({ status: 'in_progress', redoDueAt: '2026-09-27T02:00:00.000Z' });

    now = '2026-09-27T02:00:00.001Z';
    expect(await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('too-late') }], 4, 1, 'operation_redo_draft_expired')).toMatchObject({ ok: false, error: { code: 'TASK_NOT_SUBMITTABLE' } });
    now = '2026-09-27T02:00:00.000Z';
    const submitted = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('corrected') }], 4, 1, 'operation_redo_draft_submit');
    expect(submitted).toMatchObject({ ok: true, data: { submissionVersion: 2, assignmentVersion: 5 } });
    expect(harness.repository.debugSnapshot().assignments[0]).toMatchObject({ status: 'awaiting_review', redoDueAt: null });
  });

  it('教师撤权后立即不能点评；家长解绑后立即不能读取历史结果', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    const submitted = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: exerciseResult('answer') }], 1, undefined, 'operation_submit_before_revoke');
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');

    expect((await harness.service.getSubmissionForReview(teacher, submitted.data.submissionId)).ok).toBe(true);
    harness.teacherGrants[0] = { ...harness.teacherGrants[0], status: 'revoked', version: 2 };
    await harness.repository.commitTeacherGrant(harness.teacherGrants[0]);
    expect(await harness.service.getSubmissionForReview(teacher, submitted.data.submissionId)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'approved',
      score: 88,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_after_revoke')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    expect((await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId)).ok).toBe(true);
    harness.parentLinks[0] = { ...harness.parentLinks[0], status: 'revoked', version: 2 };
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('教师授权撤销事务先提交时，并发发布在事务内复核后失败且不留下成功状态', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '撤权发布交错演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_before_publish_revoke');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');

    const revoked = { ...harness.teacherGrants[0], status: 'revoked' as const, version: 2 };
    const revokeCommit = harness.repository.commitTeacherGrant(revoked);
    const publish = harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_after_revoke_commit');
    await revokeCommit;
    expect(await publish).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.teacherGrants).toEqual([expect.objectContaining({ status: 'revoked', version: 2 })]);
    expect(snapshot.tasks).toEqual([expect.objectContaining({ id: draft.data.taskId, status: 'draft', version: 1 })]);
    expect(snapshot.assignments).toHaveLength(0);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_publish_after_revoke_commit' && record.status === 'succeeded')).toHaveLength(0);
    expect(snapshot.operationLogs.filter((entry) => entry.action === 'task.publish' && entry.result === 'succeeded')).toHaveLength(0);
  });

  it('教师授权撤销事务先提交时，并发点评失败且提交聚合保持待检查', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);
    const submitted = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('review-revoke-race') }],
      1,
      undefined,
      'operation_submit_before_review_revoke',
    );
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');

    const revoked = { ...harness.teacherGrants[0], status: 'revoked' as const, version: 2 };
    const revokeCommit = harness.repository.commitTeacherGrant(revoked);
    const review = harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'approved',
      score: 91,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_after_revoke_commit');
    await revokeCommit;
    expect(await review).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toHaveLength(0);
    expect(snapshot.submissions).toEqual([expect.objectContaining({ id: submitted.data.submissionId, status: 'submitted' })]);
    expect(snapshot.assignments).toEqual([expect.objectContaining({ status: 'awaiting_review', version: 2 })]);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_review_after_revoke_commit' && record.status === 'succeeded')).toHaveLength(0);
    expect(snapshot.operationLogs.filter((entry) => (entry.action === 'submission.review' || entry.action === 'submission.return') && entry.targetId === submitted.data.submissionId)).toHaveLength(0);
  });

  it('事务内同时复核 actor 班级 scope，旧会话扩大范围不能保存草稿', async () => {
    const harness = createHarness();
    const actorWithoutScope = { ...teacher, scopeIds: [] };
    expect(await harness.service.saveTaskDraft(actorWithoutScope, {
      title: '越权范围演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_without_actor_scope')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_save_without_actor_scope' && record.status === 'succeeded')).toHaveLength(0);
  });

  it('本地审计写入失败时回滚任务聚合且不会返回发布成功', async () => {
    const harness = createHarness({ failAudit: true });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '审计失败回滚演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_audit_failure_task');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');

    await expect(harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_audit_failure')).rejects.toThrow('simulated audit.append failure');
    expect(await harness.repository.findTask(ORGANIZATION_ID, draft.data.taskId)).toMatchObject({ status: 'draft', version: 1 });
    expect(await harness.repository.findAssignment(ORGANIZATION_ID, draft.data.taskId, STUDENT_ID)).toBeNull();
    const snapshot = harness.repository.debugSnapshot();
    expect(snapshot.operationLogs).toHaveLength(0);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_publish_audit_failure')).toHaveLength(0);
  });

  it('发布业务完成后幂等最终结果写入失败时回滚业务、审计和 processing 记录', async () => {
    const harness = createHarness();
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '发布幂等故障演示任务',
      itemRefs: [{
        id: 'item_exercise',
        resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'manual', maxScore: 100 },
        order: 1,
      }],
      targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_save_before_idempotency_failure');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');

    harness.repository.failNext('idempotency.finalize');
    await expect(harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_idempotency_failure'))
      .rejects.toThrow('simulated idempotency.finalize failure');

    const rolledBack = harness.repository.debugSnapshot();
    expect(rolledBack.tasks).toEqual([expect.objectContaining({ id: draft.data.taskId, status: 'draft', version: 1 })]);
    expect(rolledBack.assignments).toHaveLength(0);
    expect(rolledBack.operationLogs).toHaveLength(0);
    expect(rolledBack.idempotencyRecords.filter((record) => record.operationId === 'operation_publish_idempotency_failure')).toHaveLength(0);

    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_publish_idempotency_failure')).toMatchObject({
      ok: true,
      data: { assignmentCount: 1, version: 2 },
    });
  });

  it('提交与点评的幂等最终结果故障均回滚各自业务聚合与审计', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);

    harness.repository.failNext('idempotency.finalize');
    await expect(harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('idempotency-submit') }],
      1,
      undefined,
      'operation_submit_idempotency_failure',
    )).rejects.toThrow('simulated idempotency.finalize failure');
    let snapshot = harness.repository.debugSnapshot();
    expect(snapshot.assignments[0]).toMatchObject({ version: 1, status: 'not_started', latestSubmissionId: null });
    expect(snapshot.submissions).toHaveLength(0);
    expect(snapshot.operationLogs.filter((entry) => entry.action === 'submission.submit')).toHaveLength(0);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_submit_idempotency_failure')).toHaveLength(0);

    const submitted = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('idempotency-submit') }],
      1,
      undefined,
      'operation_submit_idempotency_failure',
    );
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');

    harness.repository.failNext('idempotency.finalize');
    await expect(harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'approved',
      score: 90,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_idempotency_failure')).rejects.toThrow('simulated idempotency.finalize failure');
    snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toHaveLength(0);
    expect(snapshot.submissions[0]).toMatchObject({ status: 'submitted' });
    expect(snapshot.assignments[0]).toMatchObject({ version: 2, status: 'awaiting_review' });
    expect(snapshot.operationLogs.filter((entry) => entry.action === 'submission.review')).toHaveLength(0);
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_review_idempotency_failure')).toHaveLength(0);

    expect(await harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'approved',
      score: 90,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_idempotency_failure')).toMatchObject({ ok: true, data: { decision: 'approved' } });
  });

  it('提交和点评审计失败时不留下业务数据或幂等 processing 记录', async () => {
    const harness = createHarness();
    const taskId = await publishSingleStudentTask(harness);

    harness.repository.failNext('audit.append');
    await expect(harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('audit-submit') }],
      1,
      undefined,
      'operation_submit_audit_failure',
    )).rejects.toThrow('simulated audit.append failure');
    let snapshot = harness.repository.debugSnapshot();
    expect(snapshot.submissions).toHaveLength(0);
    expect(snapshot.assignments[0]).toMatchObject({ version: 1, status: 'not_started' });
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_submit_audit_failure')).toHaveLength(0);

    const submitted = await harness.service.submit(
      student,
      taskId,
      [{ itemId: 'item_exercise', value: exerciseResult('audit-submit') }],
      1,
      undefined,
      'operation_submit_audit_failure',
    );
    if (!submitted.ok || typeof submitted.data.submissionId !== 'string') throw new Error('submission expected');

    harness.repository.failNext('audit.append');
    await expect(harness.service.publishReview(teacher, {
      submissionId: submitted.data.submissionId,
      decision: 'returned',
      returnReason: '请重新检查答案。',
      score: 0,
      expectedSubmissionVersion: 1,
    }, 2, 'operation_review_audit_failure')).rejects.toThrow('simulated audit.append failure');
    snapshot = harness.repository.debugSnapshot();
    expect(snapshot.feedback).toHaveLength(0);
    expect(snapshot.submissions[0]).toMatchObject({ status: 'submitted' });
    expect(snapshot.assignments[0]).toMatchObject({ version: 2, status: 'awaiting_review', redoCount: 0 });
    expect(snapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_review_audit_failure')).toHaveLength(0);
  });

  it('并发复用同 operationId：同请求返回首次稳定结果且只写一次，不同请求返回 CONFLICT', async () => {
    const sameRequestHarness = createHarness();
    const sameRequestTaskId = await publishSingleStudentTask(sameRequestHarness);
    const submitSame = () => sameRequestHarness.service.submit(
      student,
      sameRequestTaskId,
      [{ itemId: 'item_exercise', value: exerciseResult('same-operation') }],
      1,
      undefined,
      'operation_submit_concurrent_same',
    );
    const [sameFirst, sameSecond] = await Promise.all([submitSame(), submitSame()]);
    expect(sameFirst).toEqual(sameSecond);
    expect(sameFirst.ok).toBe(true);
    const sameSnapshot = sameRequestHarness.repository.debugSnapshot();
    expect(sameSnapshot.submissions).toHaveLength(1);
    expect(sameSnapshot.operationLogs.filter((entry) => entry.action === 'submission.submit')).toHaveLength(1);
    expect(sameSnapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_submit_concurrent_same')).toEqual([
      expect.objectContaining({ status: 'succeeded' }),
    ]);

    const changedRequestHarness = createHarness();
    const changedRequestTaskId = await publishSingleStudentTask(changedRequestHarness);
    const [changedFirst, changedSecond] = await Promise.all([
      changedRequestHarness.service.submit(student, changedRequestTaskId, [{ itemId: 'item_exercise', value: exerciseResult('payload-a') }], 1, undefined, 'operation_submit_concurrent_changed'),
      changedRequestHarness.service.submit(student, changedRequestTaskId, [{ itemId: 'item_exercise', value: exerciseResult('payload-b') }], 1, undefined, 'operation_submit_concurrent_changed'),
    ]);
    const changedResults = [changedFirst, changedSecond];
    expect(changedResults.filter((result) => result.ok)).toHaveLength(1);
    expect(changedResults.filter((result) => !result.ok && result.error.code === 'CONFLICT')).toHaveLength(1);
    const changedSnapshot = changedRequestHarness.repository.debugSnapshot();
    expect(changedSnapshot.submissions).toHaveLength(1);
    expect(changedSnapshot.operationLogs.filter((entry) => entry.action === 'submission.submit')).toHaveLength(1);
    expect(changedSnapshot.idempotencyRecords.filter((record) => record.operationId === 'operation_submit_concurrent_changed')).toHaveLength(1);
  });
});

describe('M2 单题作答证据', () => {
  const questionPayload: JsonObject = {
    questionIds: ['resource_demo_exercise'], questionType: 'single_choice', stem: 'Which animal can fly?',
    options: ['A. bird', 'B. lion'], correctAnswer: 'A. bird', explanation: 'Birds can fly.',
  };

  it('按发布快照逐题验证并由服务端写入客观题判定', async () => {
    const harness = createHarness({ resourcePayload: questionPayload });
    const taskId = await publishSingleStudentTask(harness);
    const beforeSubmit = harness.repository.debugSnapshot();
    const studentQuery = new StudentTaskQueryService({
      repository: new InMemoryTaskQueryRepository({ tasks: beforeSubmit.tasks, assignments: beforeSubmit.assignments,
        submissions: beforeSubmit.submissions, feedback: beforeSubmit.feedback }),
      clock: { nowIso: () => '2026-09-16T02:00:00.000Z' }, requestIds: { next: () => 'request_m2_student_detail' },
    });
    const studentDetail = await studentQuery.getMyTask(student, taskId);
    expect(studentDetail).toMatchObject({ ok: true, data: { items: [{ exerciseQuestion: {
      questionId: 'resource_demo_exercise', stem: 'Which animal can fly?', options: ['A. bird', 'B. lion'],
    } }] } });
    expect(JSON.stringify(studentDetail)).not.toContain('correctAnswer');
    expect(JSON.stringify(studentDetail)).not.toContain('Birds can fly.');
    harness.repository.upsertResource({
      id: 'resource_demo_exercise', organizationId: ORGANIZATION_ID, type: 'exercise', title: '资源已变更',
      contentVersion: 4, status: 'offline', visibility: 'classes', allowedClassIds: [CLASS_ID],
      payload: { ...questionPayload, correctAnswer: 'B. lion' },
    });

    expect(await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: { kind: 'exercise', answeredQuestionCount: 1 } }],
      1, undefined, 'operation_m2_forged_count')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: {
      kind: 'exercise', questionResponses: [{ questionId: 'resource_demo_exercise', response: 'A. bird', isCorrect: true }],
    } }], 1, undefined, 'operation_m2_forged_grade')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const submitted = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: {
      kind: 'exercise', questionResponses: [{ questionId: 'resource_demo_exercise', response: 'A. bird' }],
    } }], 1, undefined, 'operation_m2_real_answer');
    expect(submitted).toMatchObject({ ok: true });
    expect(harness.repository.debugSnapshot().submissions).toMatchObject([{ answers: [{ value: {
      kind: 'exercise', answeredQuestionCount: 1, correctQuestionCount: 1,
      questionResponses: [{ questionId: 'resource_demo_exercise', response: 'A. bird', isCorrect: true }],
    } }] }]);
    expect((await harness.repository.findTask(ORGANIZATION_ID, taskId))?.items[0]?.resourceSnapshot.payload.correctAnswer).toBe('A. bird');
    const savedSubmissionId = harness.repository.debugSnapshot().submissions[0]?.id;
    if (!savedSubmissionId) throw new Error('submission not saved');
    const reviewer = createReviewQueryFromCore(harness, new InMemoryOpaqueCursorCodec({ next: () => 'review_cursor_m2' }));
    expect(await reviewer.getSubmissionForReview(teacher, savedSubmissionId)).toMatchObject({ ok: true, data: { automaticScore: 100, exerciseEvidence: [{
      itemId: 'item_exercise', questionId: 'resource_demo_exercise', studentResponse: 'A. bird',
      correctAnswer: 'A. bird', isCorrect: true, recorded: true,
    }] } });
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId)).toMatchObject({
      ok: true, data: { automaticScore: 100, feedback: null },
    });
    expect(await harness.service.publishReview(teacher, {
      submissionId: savedSubmissionId, expectedSubmissionVersion: 1, decision: 'approved', textComment: '自动判分已核对',
    }, 2, 'operation_m2_review_auto')).toMatchObject({ ok: true });
    expect(harness.repository.debugSnapshot().feedback).toMatchObject([{ score: 100, originalAutomaticScore: 100 }]);
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId)).toMatchObject({
      ok: true, data: { automaticScore: 100, feedback: { score: 100 } },
    });
  });

  it('教师覆盖自动分须说明原因并保留原始分', async () => {
    const harness = createHarness({ resourcePayload: questionPayload });
    const taskId = await publishSingleStudentTask(harness);
    const submitted = await harness.service.submit(student, taskId, [{ itemId: 'item_exercise', value: {
      kind: 'exercise', questionResponses: [{ questionId: 'resource_demo_exercise', response: 'B. lion' }],
    } }], 1, undefined, 'operation_m2_wrong_answer');
    if (!submitted.ok) throw new Error('submission expected');
    const submissionId = harness.repository.debugSnapshot().submissions[0]?.id;
    if (!submissionId) throw new Error('submission missing');
    const reviewInput = { submissionId, expectedSubmissionVersion: 1, decision: 'approved' as const,
      score: 75, textComment: '核对后调整' };
    expect(await harness.service.publishReview(teacher, reviewInput, 2, 'operation_m2_override_without_reason'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { overrideReason: expect.any(String) } } });
    expect(harness.repository.debugSnapshot().feedback).toHaveLength(0);
    expect(await harness.service.publishReview(teacher, { ...reviewInput, overrideReason: '主观补充作答已核实' },
      2, 'operation_m2_override_with_reason')).toMatchObject({ ok: true });
    expect(harness.repository.debugSnapshot().feedback).toMatchObject([{
      score: 75, originalAutomaticScore: 0, overrideReason: '主观补充作答已核实',
    }]);
    const reviewer = createReviewQueryFromCore(harness, new InMemoryOpaqueCursorCodec({ next: () => 'review_cursor_override' }));
    expect(await reviewer.getSubmissionForReview(teacher, submissionId)).toMatchObject({ ok: true, data: { feedback: {
      score: 75, originalAutomaticScore: 0, overrideReason: '主观补充作答已核实',
    } } });
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId)).toMatchObject({
      ok: true, data: { automaticScore: 0, feedback: { score: 75 } },
    });
  });

  it('多道客观题按发布快照权重汇总并在教师完成情况中实时可查', async () => {
    const harness = createHarness({ resourcePayload: questionPayload });
    harness.repository.upsertResource({
      id: 'resource_second', organizationId: ORGANIZATION_ID, type: 'exercise', title: '第二道虚构题目',
      contentVersion: 1, status: 'published', visibility: 'classes', allowedClassIds: [CLASS_ID],
      payload: { questionIds: ['resource_second'], questionType: 'single_choice', stem: 'Choose a color',
        options: ['A. red', 'B. blue'], correctAnswer: 'A. red', explanation: 'Red is a color.' },
    });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '双题自动计分', targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
      itemRefs: [
        { id: 'item_first', resourceId: 'resource_demo_exercise', completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
          scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 75 }, order: 1 },
        { id: 'item_second', resourceId: 'resource_second', completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
          scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 25 }, order: 2 },
      ],
    }, 0, 'operation_m2_weighted_draft');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    const taskId = draft.data.taskId;
    expect(await harness.service.publishTask(teacher, taskId, 1, 'operation_m2_weighted_publish')).toMatchObject({ ok: true });
    expect(await harness.service.submit(student, taskId, [
      { itemId: 'item_first', value: { kind: 'exercise', questionResponses: [{ questionId: 'resource_demo_exercise', response: 'A. bird' }] } },
      { itemId: 'item_second', value: { kind: 'exercise', questionResponses: [{ questionId: 'resource_second', response: 'B. blue' }] } },
    ], 1, undefined, 'operation_m2_weighted_submit')).toMatchObject({ ok: true });
    expect(await harness.service.getParentTaskResult(parent, STUDENT_ID, taskId)).toMatchObject({ ok: true, data: { automaticScore: 75 } });
    const snapshot = harness.repository.debugSnapshot();
    const taskQueries = new TeacherTaskQueryService({
      repository: new InMemoryTaskQueryRepository({
        teacherGrants: snapshot.teacherGrants.map((grant) => ({ id: grant._id, organizationId: grant.organizationId,
          teacherId: grant.teacherId, classId: grant.classId, className: '三年级 2 班', permissions: grant.permissions, status: grant.status })),
        tasks: snapshot.tasks, assignments: snapshot.assignments, submissions: snapshot.submissions, feedback: snapshot.feedback,
      }),
      clock: { nowIso: () => '2026-09-16T02:00:00.000Z' }, requestIds: { next: () => 'request_m2_completion' },
    });
    expect(await taskQueries.getCompletion(teacher, taskId, {}, { limit: 20 })).toMatchObject({
      ok: true, data: { assignments: { items: [{ score: 75 }] } },
    });
  });

  it('发布前拒绝未凑满 100% 的内容权重且不生成学生任务', async () => {
    const harness = createHarness({ resourcePayload: questionPayload });
    const draft = await harness.service.saveTaskDraft(teacher, {
      title: '错误权重演示', targetClassIds: [CLASS_ID], startsAt: '2026-09-16T00:00:00.000Z',
      dueAt: '2026-09-16T12:00:00.000Z', latePolicy: { allowLate: true, lateDays: 7 },
      itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'exercise_questions', requiredQuestionCount: 1 },
        scoringRule: { kind: 'automatic', maxScore: 100, weightPercent: 50 }, order: 1 }],
    }, 0, 'operation_m2_bad_weight_draft');
    if (!draft.ok || typeof draft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await harness.service.publishTask(teacher, draft.data.taskId, 1, 'operation_m2_bad_weight_publish'))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { itemRefs: expect.any(String) } } });
    expect(harness.repository.debugSnapshot().assignments).toHaveLength(0);
  });

  it('M2 录音任务只接受文字提示与本人同轮次封存音频，并要求教师评分', async () => {
    const invalid = createHarness({ resourceType: 'recording', resourcePayload: {
      promptKind: 'text', promptText: '跟着视频完成录音', requiresVideo: true } });
    const invalidDraft = await invalid.service.saveTaskDraft(teacher, {
      title: '无效视频录音任务', itemRefs: [{ id: 'item_exercise', resourceId: 'resource_demo_exercise',
        completionRule: { kind: 'recording_upload' }, order: 1 }], targetClassIds: [CLASS_ID],
      startsAt: '2026-09-16T00:00:00.000Z', dueAt: '2026-09-16T12:00:00.000Z',
      latePolicy: { allowLate: true, lateDays: 7 },
    }, 0, 'operation_recording_invalid_draft');
    if (!invalidDraft.ok || typeof invalidDraft.data.taskId !== 'string') throw new Error('draft expected');
    expect(await invalid.service.publishTask(teacher, invalidDraft.data.taskId, 1,
      'operation_recording_invalid_publish')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const valid = createHarness({ resourceType: 'recording', resourcePayload: {
      promptKind: 'text', promptText: '请朗读：The animal is happy.', requiresVideo: false } });
    const taskId = await publishSingleStudentTask(valid, { kind: 'recording_upload' });
    const assignment = valid.repository.debugSnapshot().assignments[0]!;
    const answer = [{ itemId: 'item_exercise', value: { kind: 'recording', recordingId: 'recording_valid' } }];
    expect(await valid.service.submit(student, taskId, answer, 1, undefined,
      'operation_recording_forged')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    valid.repository.seedTaskRecordings([{ id: 'recording_valid', organizationId: ORGANIZATION_ID,
      taskId, itemId: 'item_exercise', assignmentId: assignment.id, submissionVersion: 1,
      studentId: STUDENT_ID, classId: CLASS_ID, resourceVersion: 3, stagingPath: 'virtual',
      status: 'submitted', fileId: 'cloud://virtual/private.mp3', contentSha256: 'a'.repeat(64),
      sizeBytes: 25000, durationMs: 4000, version: 2,
      createdAt: '2026-09-16T01:00:00.000Z', submittedAt: '2026-09-16T01:01:00.000Z' }]);
    const submitted = await valid.service.submit(student, taskId, answer, 1, undefined,
      'operation_recording_submitted');
    expect(submitted).toMatchObject({ ok: true });
    const submission = valid.repository.debugSnapshot().submissions.find((item) => item.status === 'submitted');
    expect(submission?.answers[0]?.value).toMatchObject({ kind: 'recording', recordingId: 'recording_valid',
      durationMs: 4000, sizeBytes: 25000 });
    if (!submission) throw new Error('submitted recording expected');
    expect(await valid.service.publishReview(teacher, { submissionId: submission.id,
      expectedSubmissionVersion: 1, decision: 'approved', textComment: '虚构点评' }, 2,
    'operation_recording_unscored_review')).toMatchObject({ ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { itemScores: expect.any(String) } } });
    expect(await valid.service.publishReview(teacher, { submissionId: submission.id,
      expectedSubmissionVersion: 1, decision: 'approved', itemScores: [{ itemId: 'item_exercise', score: 88 }],
      textComment: '虚构点评' }, 2,
    'operation_recording_scored_review')).toMatchObject({ ok: true });
  });
});
