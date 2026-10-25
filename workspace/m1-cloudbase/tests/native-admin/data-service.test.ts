import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { NativeAdminDataService } from '../../src/native-admin/data-service';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';

const actor: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher', permissions: ['task.read'],
  scopeIds: ['class_one'], authzVersion: 2 };

function fixture(permissions: string[] = ['dashboard.read', 'organization.manage', 'user.manage']) {
  const base = { organizationId: 'org_demo', schemaVersion: 1 as const, version: 1,
    deletedAt: null };
  const database = new FakeDocumentDatabase({
    users: [
      { _id: 'teacher_demo', ...base, authorizationVersion: 2, status: 'active' },
      { _id: 'student_one', ...base, displayNameMasked: '虚构学员甲', studentNumber: 'DEMO001', status: 'active' },
      { _id: 'student_two', ...base, displayNameMasked: '虚构学员乙', studentNumber: 'DEMO002', status: 'active' },
      { _id: 'parent_one', ...base, displayNameMasked: '虚构家长甲', status: 'active' },
    ],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'teacher_demo'), ...base,
      teacherId: 'teacher_demo', status: 'active', version: 1,
      permissions,
      scope: { organizationWide: false, classIds: ['class_one'] } }],
    classes: [
      { _id: 'class_one', ...base, name: '虚构一班', grade: 3, term: '秋季', status: 'active' },
      { _id: 'class_two', ...base, name: '虚构二班', grade: 4, term: '秋季', status: 'active' },
    ],
    class_memberships: [
      { _id: 'member_one', ...base, classId: 'class_one', studentId: 'student_one', status: 'active' },
      { _id: 'member_two', ...base, classId: 'class_two', studentId: 'student_two', status: 'active' },
    ],
    role_assignments: [
      { _id: 'role_one', ...base, userId: 'student_one', role: 'student', status: 'active' },
      { _id: 'role_two', ...base, userId: 'student_two', role: 'student', status: 'active' },
      { _id: 'role_parent', ...base, userId: 'parent_one', role: 'parent', status: 'active' },
      { _id: 'role_teacher', ...base, userId: 'teacher_demo', role: 'teacher', status: 'active' },
    ],
    parent_student_links: [{ _id: 'link_one', ...base, parentId: 'parent_one', studentId: 'student_one',
      status: 'active', confirmedAt: '2026-10-05T08:00:00+08:00' }],
    teacher_media_records: [
      { _id: 'old_teacher_upload', ...base, title: '旧教师上传草稿', status: 'pending_review',
        kind: 'listening', allowedClassIds: ['class_one'] },
    ],
    learning_resources: [
      { _id: 'textbook_one', ...base, type: 'reading', category: 'synchronized',
        title: '虚构同步课本', status: 'draft', allowedClassIds: ['class_one'] },
      { _id: 'question_one', ...base, type: 'exercise', title: '虚构习题', status: 'published',
        questionType: 'single_choice', visibility: { type: 'classes', classIds: ['class_one'] },
        correctAnswer: 'secret-answer' },
      { _id: 'media_one', ...base, type: 'listening', title: '虚构班级音频', status: 'draft',
        contentVersion: 2, visibility: { type: 'classes', classIds: ['class_one'] },
        payload: { assetLibrary: { kind: 'central_asset_library', resourceId: 'media_one',
          version: 2, manifestSha256: 'a'.repeat(64), reviewId: 'review_media_one',
          importedBy: 'asset_editor_demo', reviewStatus: 'pending' },
        teacherMedia: { status: 'pending_review', scanStatus: 'pending', transcodeStatus: 'pending',
          stagingPath: 'private/secret.mp3', answerKeys: [{ questionId: 'q1', correctAnswer: 'secret-answer' }],
          questionIds: ['q1'], clips: [], sourceScanEvidence: null,
          scanEvidence: null, transcodeEvidence: null, copyrightEvidenceKey: null } } },
      { _id: 'media_two', ...base, type: 'listening', title: '另一班音频', status: 'draft',
        contentVersion: 1, visibility: { type: 'classes', classIds: ['class_two'] },
        payload: { assetLibrary: { kind: 'central_asset_library', resourceId: 'media_two',
          version: 1, manifestSha256: 'b'.repeat(64), reviewId: 'review_media_two',
          importedBy: 'asset_editor_demo', reviewStatus: 'pending' }, teacherMedia: { status: 'pending_review' } } },
    ],
    tasks: [{ _id: 'task_one', ...base, title: '虚构课堂任务', status: 'active', classIds: ['class_one'] }],
    checkin_activities: [{ _id: 'activity_one', ...base, status: 'published',
      payload: { title: '虚构打卡', status: 'published' }, schedule: { classId: 'class_one' } }],
  });
  return new NativeAdminDataService(new DocumentNativeAdminGrantRepository(database), database);
}

describe('native management read projections', () => {
  it('shows an offline media record as offline when its embedded media status is stale', async () => {
    const base = { organizationId: 'org_demo', schemaVersion: 1 as const,
      version: 3, deletedAt: null }
    const database = new FakeDocumentDatabase({
      users: [{ _id: 'teacher_demo', ...base, authorizationVersion: 2, status: 'active' }],
      native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'teacher_demo'), ...base,
        teacherId: 'teacher_demo', status: 'active', permissions: ['dashboard.read', 'media.review'],
        scope: { organizationWide: false, classIds: ['class_one'] } }],
      learning_resources: [{ _id: 'media_superseded', ...base, type: 'video',
        title: '虚构旧视频', status: 'offline', contentVersion: 1,
        visibility: { type: 'classes', classIds: ['class_one'] },
        payload: { assetLibrary: { kind: 'central_asset_library', resourceId: 'media_superseded',
          version: 1, manifestSha256: 'a'.repeat(64), reviewId: 'review_media_superseded',
          importedBy: 'asset_editor_demo', reviewStatus: 'approved' },
        teacherMedia: { status: 'published' } } }],
    })
    const service = new NativeAdminDataService(new DocumentNativeAdminGrantRepository(database), database)
    expect(await service.listRecords(actor, 'media', 20, 0)).toMatchObject({
      items: [{ id: 'media_superseded', status: 'offline', statusLabel: '已下架' }],
    })
    expect(await service.listRecords(actor, 'media', 20, 0, { status: 'published' }))
      .toMatchObject({ items: [] })
    expect(await service.getMediaReviewSummary(actor, 'media_superseded'))
      .toMatchObject({ status: 'offline', statusLabel: '已下架' })
  })

  it('shows only the granted class and its students', async () => {
    const service = fixture();
    expect(await service.getOverview(actor)).toMatchObject({ classCount: 1, userCount: 1,
      taskCount: 2, activeTaskCount: 2, pendingReviewCount: 0 });
    expect(await service.listClasses(actor, 20, 0)).toMatchObject({ items: [{ id: 'class_one',
      studentCount: 1 }], nextOffset: null });
    expect(await service.listUsers(actor, 'class_one', 20, 0)).toMatchObject({ items: [{
      id: 'student_one', roleLabel: '学员', bindingCount: 1 }], nextOffset: null });
    expect(await service.listUserBindings(actor, 'student_one')).toMatchObject({ items: [{
      id: 'link_one', parentName: '虚构家长甲', studentName: '虚构学员甲', status: 'active' }] });
    await expect(service.listUsers(actor, 'class_two', 20, 0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listUsers(actor, '', 20, 0)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an old session before reading management data', async () => {
    const service = fixture();
    await expect(service.listClasses({ ...actor, authzVersion: 1 }, 20, 0))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('searches the full authorized class and user result set before paging', async () => {
    const service = fixture()
    expect(await service.listClasses(actor, 20, 0, '虚构一')).toMatchObject({
      items: [{ id: 'class_one' }], nextOffset: null })
    expect(await service.listUsers(actor, 'class_one', 20, 0, 'DEMO001')).toMatchObject({
      items: [{ id: 'student_one' }], nextOffset: null })
    expect(await service.listUsers(actor, 'class_one', 20, 0, 'DEMO002'))
      .toMatchObject({ items: [], nextOffset: null })
  })

  it('filters roles before enriching only the requested user page', async () => {
    const base = { organizationId: 'org_demo', schemaVersion: 1 as const,
      version: 1, deletedAt: null };
    const students = Array.from({ length: 40 }, (_, index) => ({
      _id: `student_${String(index).padStart(2, '0')}`, ...base,
      displayNameMasked: `虚构学员${index}`, status: 'active',
    }));
    const database = new FakeDocumentDatabase({
      users: [{ _id: 'teacher_demo', ...base, status: 'active', authorizationVersion: 2 },
        ...students],
      role_assignments: students.map((student, index) => ({
        _id: `role_${index}`, ...base, userId: student._id,
        role: 'student', status: 'active',
      })),
      native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'teacher_demo'),
        ...base, teacherId: 'teacher_demo', status: 'active',
        permissions: ['dashboard.read', 'user.manage'],
        scope: { organizationWide: true, classIds: [] } }],
    });
    const find = vi.spyOn(database, 'find');
    const service = new NativeAdminDataService(new DocumentNativeAdminGrantRepository(database), database);
    const page = await service.listUsers(actor, '', 5, 0, '', 'student');
    expect(page.items.map(item => item.id)).toEqual(students.slice(0, 5).map(item => item._id));
    expect(page.nextOffset).toBe(5);
    expect(find.mock.calls.filter(([collection]) => collection === 'parent_student_links'))
      .toHaveLength(5);
  });

  it('offers only scoped classes and minimal role candidates for management forms', async () => {
    const service = fixture(['dashboard.read', 'organization.manage',
      'user.manage', 'authorization.manage']);
    expect(await service.listSelectionOptions(actor, 'class_for_user', '', 20, 0))
      .toMatchObject({ items: [{ id: 'class_one' }] });
    expect(await service.listSelectionOptions(actor, 'class_for_grant', '', 20, 0))
      .toMatchObject({ items: [{ id: 'class_one' }] });
    expect(await service.listSelectionOptions(actor, 'teacher_for_class', 'class_one', 20, 0))
      .toMatchObject({ items: [{ id: 'teacher_demo' }] });
    expect(await service.listSelectionOptions(actor, 'student_for_binding', 'class_one', 20, 0))
      .toMatchObject({ items: [{ id: 'student_one' }] });
    expect(await service.listSelectionOptions(actor, 'parent_for_binding', 'class_one', 20, 0))
      .toMatchObject({ items: [{ id: 'parent_one' }] });
    await expect(service.listSelectionOptions(actor, 'teacher_for_class', 'class_two', 20, 0))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('filters media by the separate review grant and never projects private evidence', async () => {
    await expect(fixture().listRecords(actor, 'media', 20, 0))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const service = fixture(['dashboard.read', 'media.review', 'textbook.manage',
      'question.manage', 'task.manage']);
    const media = await service.listRecords(actor, 'media', 20, 0);
    expect(media).toMatchObject({ items: [{ id: 'media_one', title: '虚构班级音频',
      status: 'pending_review', statusLabel: '缺项或待处理' }] });
    expect(JSON.stringify(media)).not.toContain('old_teacher_upload');
    expect(JSON.stringify(media)).not.toContain('private/');
    const summary = await service.getMediaReviewSummary(actor, 'media_one');
    expect(summary).toMatchObject({ statusLabel: '缺项或待处理', scanStatus: 'pending',
      sourceScanEvidencePresent: false, copyrightEvidencePresent: false,
      questionCount: 1, clipCount: 0 });
    expect(JSON.stringify(summary)).not.toContain('private/');
    expect(JSON.stringify(summary)).not.toContain('secret-answer');
    await expect(service.getMediaReviewSummary(actor, 'media_two'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.listRecords(actor, 'textbooks', 20, 0))
      .toMatchObject({ items: [{ id: 'textbook_one', title: '虚构同步课本', statusLabel: '草稿' }] });
    const question = await service.listRecords(actor, 'questions', 20, 0);
    expect(question).toMatchObject({ items: [{ id: 'question_one', title: '虚构习题', statusLabel: '已上架' }] });
    expect(JSON.stringify(question)).not.toContain('secret-answer');
    expect(await service.getQuestionPreview(actor, 'question_one')).toMatchObject({
      id: 'question_one', questionType: 'single_choice', answer: 'secret-answer',
      organizationWide: false, classIds: ['class_one'] });
    expect(await service.listRecords(actor, 'tasks', 20, 0))
      .toMatchObject({ items: [{ id: 'activity_one', title: '虚构打卡', statusLabel: '进行中' },
        { id: 'task_one', title: '虚构课堂任务', statusLabel: '进行中' }] });
  });

  it('filters task/activity lists and exports only rows matching the current filters', async () => {
    const service = fixture(['dashboard.read', 'task.manage'])
    expect(await service.listRecords(actor, 'tasks', 20, 0,
      { taskType: 'activity', status: 'published' })).toMatchObject({
      items: [{ id: 'activity_one' }], nextOffset: null })
    const exported = await service.exportTaskRecords(actor, { query: '课堂任务' })
    expect(exported.rowCount).toBe(1)
    expect(exported.csv).toContain('虚构课堂任务')
    expect(exported.csv).not.toContain('虚构打卡')
  })

  it('returns minimal management audit fields within the current scope', async () => {
    const base = { organizationId: 'org_demo', schemaVersion: 1 as const, version: 1, deletedAt: null }
    const database = new FakeDocumentDatabase({
      ...snapshotForAudit(base),
    })
    const service = new NativeAdminDataService(new DocumentNativeAdminGrantRepository(database), database)
    const rows = await service.listAudit(actor, 20, 0)
    expect(rows.items).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('private-reason')
  })
});

function snapshotForAudit(base: { organizationId: string; schemaVersion: 1; version: number; deletedAt: null }) {
  return {
    users: [{ _id: 'teacher_demo', ...base, authorizationVersion: 2, status: 'active' }],
    native_admin_grants: [{ _id: nativeAdminGrantId('org_demo', 'teacher_demo'), ...base,
      teacherId: 'teacher_demo', status: 'active', version: 1,
      permissions: ['dashboard.read', 'authorization.manage'],
      scope: { organizationWide: false, classIds: ['class_one'] } }],
    operation_logs: [
      { _id: 'audit_own', ...base, action: 'native_admin.teacher.granted', targetType: 'teacher',
        targetId: 'teacher_two', actorUserId: 'teacher_demo', result: 'succeeded',
        occurredAt: '2026-10-06T10:00:00+08:00', metadata: { reason: 'private-reason' } },
      { _id: 'audit_unrelated', ...base, action: 'native_admin.user.updated', targetType: 'user',
        targetId: 'student_one', actorUserId: 'teacher_demo', result: 'succeeded',
        occurredAt: '2026-10-06T10:30:00+08:00' },
      { _id: 'audit_other', ...base, action: 'native_admin.teacher.granted', targetType: 'teacher',
        targetId: 'teacher_three', actorUserId: 'teacher_elsewhere', result: 'succeeded',
        occurredAt: '2026-10-06T09:00:00+08:00' },
    ],
  }
}
