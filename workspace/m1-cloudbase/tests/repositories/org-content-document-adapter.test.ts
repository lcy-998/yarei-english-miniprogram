import { describe, expect, it, vi } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { ContentQueryService } from '../../src/org-content/content-service';
import type { ReadingResourceEntity, RoleAssignmentEntity } from '../../src/org-content/types';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import {
  ORG_CONTENT_COLLECTIONS,
  createOrgContentDocumentRepository,
} from '../../src/repositories/org-content-document-adapter';
import { InMemoryTaskQueryRepository } from '../../src/task-query/memory-repository';
import { TeacherStudentQueryService } from '../../src/teacher-students/service';

const ORGANIZATION_ID = 'org_demo';
const OTHER_ORGANIZATION_ID = 'org_other';
const CLASS_ID = 'class_demo';
const TEACHER_ID = 'teacher_demo';
const STUDENT_ID = 'student_demo';
const PARENT_ID = 'parent_demo';

const studentActor: TrustedActorContext = {
  requestId: 'request_student', sessionId: 'session_student', actorUserId: STUDENT_ID, actorRole: 'student',
  organizationId: ORGANIZATION_ID, platformSubjectDigest: 'digest_student', permissions: ['content.read'],
  scopeIds: [STUDENT_ID], authzVersion: 1,
};

const teacherActor: TrustedActorContext = {
  requestId: 'request_teacher', sessionId: 'session_teacher', actorUserId: TEACHER_ID, actorRole: 'teacher',
  organizationId: ORGANIZATION_ID, platformSubjectDigest: 'digest_teacher', permissions: ['student.read'],
  scopeIds: [CLASS_ID], authzVersion: 1,
};

describe('org-content document repository', () => {
  it('joins active roles for a user list in one scoped role query', async () => {
    const database = seededDatabase();
    const find = vi.spyOn(database, 'find');
    const repository = createOrgContentDocumentRepository(database);
    const users = await repository.listUsers(ORGANIZATION_ID);
    expect(users.find(user => user.id === STUDENT_ID)?.roles).toEqual(['student']);
    expect(users.some(user => user.id === 'student_other_tenant')).toBe(false);
    expect(find.mock.calls.filter(([collection]) => collection === ORG_CONTENT_COLLECTIONS.roles)).toHaveLength(1);
  });

  it('enforces tenant, soft-delete and active/published status boundaries on every scoped query', async () => {
    const repository = createOrgContentDocumentRepository(seededDatabase());

    await expect(repository.listActiveMembershipsForStudent(ORGANIZATION_ID, STUDENT_ID)).resolves.toEqual([
      expect.objectContaining({ id: 'membership_active', classId: CLASS_ID }),
    ]);
    await expect(repository.listActiveTeacherGrants(ORGANIZATION_ID, TEACHER_ID)).resolves.toEqual([
      expect.objectContaining({ id: 'grant_active', classId: CLASS_ID }),
    ]);
    await expect(repository.listActiveParentLinksForStudent(ORGANIZATION_ID, STUDENT_ID)).resolves.toEqual([
      expect.objectContaining({ id: 'link_active', parentId: PARENT_ID }),
    ]);
    await expect(repository.listLearningResources(ORGANIZATION_ID, 'reading')).resolves.toEqual([
      expect.objectContaining({ id: 'reading_published', status: 'published' }),
    ]);
    await expect(repository.findLearningResource(ORGANIZATION_ID, 'reading_offline')).resolves.toBeNull();
    await expect(repository.findLearningResource(ORGANIZATION_ID, 'reading_deleted')).resolves.toBeNull();
    await expect(repository.findClass(ORGANIZATION_ID, 'class_other_tenant')).resolves.toBeNull();
    await expect(repository.findUser(ORGANIZATION_ID, 'student_other_tenant')).resolves.toBeNull();

    const student = await repository.findUser(ORGANIZATION_ID, STUDENT_ID);
    expect(student?.roles).toEqual(['student']);
    await expect(repository.listRoleAssignments(ORGANIZATION_ID, STUDENT_ID)).resolves.toEqual([
      expect.objectContaining({ id: 'role_student_active', status: 'active', permissions: ['content.read'] }),
      expect.objectContaining({ id: 'role_student_revoked', status: 'revoked' }),
    ]);
    await expect(repository.listOperationLogs(ORGANIZATION_ID, { result: 'succeeded' })).resolves.toEqual([
      expect.objectContaining({ id: 'audit_local', organizationId: ORGANIZATION_ID, action: 'role.assigned' }),
    ]);
    await expect(repository.findClass(ORGANIZATION_ID, CLASS_ID)).resolves.toMatchObject({ grade: '3' });
  });

  it('supports content-query and never exposes private OCR/body/search fields in its safe view', async () => {
    const service = new ContentQueryService(createOrgContentDocumentRepository(seededDatabase()));

    await expect(service.getMyClass(studentActor)).resolves.toEqual({
      id: CLASS_ID, name: '虚构三年级 2 班', organizationName: '虚构学校', grade: '3', term: '上学期',
      studentCount: 1, teacherNames: [],
    });

    await expect(service.listReadingResources(studentActor)).resolves.toEqual([
      expect.objectContaining({ id: 'reading_published', title: '虚构绘本' }),
    ]);
    await expect(service.listVocabularyPacks(studentActor)).resolves.toEqual([
      expect.objectContaining({ id: 'vocabulary_published', title: '虚构单词包' }),
    ]);
    const detail = await service.getReadingResource(studentActor, 'reading_published');
    expect(detail).toMatchObject({
      presentation: 'page_images_only',
      textVisibility: { ocrExposed: false, standaloneBodyExposed: false },
      chapters: [{ pages: [{ imageAssetKey: 'demo/page-1' }] }],
    });
    expect(JSON.stringify(detail)).not.toMatch(/private OCR|private body|private search|ocrText|bodyBlocks/);
  });

  it('opens legacy demo page images through an assigned task without listing them as a new library book', async () => {
    const database = new FakeDocumentDatabase({
      [ORG_CONTENT_COLLECTIONS.memberships]: [document('membership_legacy', ORGANIZATION_ID, { classId: CLASS_ID, studentId: STUDENT_ID, status: 'active' })],
      [ORG_CONTENT_COLLECTIONS.resources]: [document('res_reading_zoo_demo', ORGANIZATION_ID, {
        type: 'reading', title: '虚构动物绘本', contentVersion: 1, status: 'published', copyrightStatus: 'demo',
        visibilityScope: { classIds: [CLASS_ID] },
        payload: { demoOnly: true, chapterCount: 3, pages: [{ id: 'page_1', chapterId: 'chapter_1', pageNumber: 1,
          thumbnailAssetKey: 'demo/page-01-thumbnail', imageAssetKey: 'demo/page-01-image', width: 1200, height: 1600, version: 1 }] },
      })],
    });
    const service = new ContentQueryService(createOrgContentDocumentRepository(database));
    await expect(service.listReadingResources(studentActor)).resolves.toEqual([]);
    await expect(service.getReadingResource(studentActor, 'res_reading_zoo_demo')).resolves.toMatchObject({
      category: 'picture_book', chapters: [{ id: 'chapter_1', pages: [{ id: 'page_1', imageAssetKey: 'demo/page-01-image', assetVersion: '1' }] }],
    });
  });

  it('supports teacher-student-query, including roles joined from active role assignments', async () => {
    const organizationRepository = createOrgContentDocumentRepository(seededDatabase());
    const taskRepository = new InMemoryTaskQueryRepository({});
    let requestSequence = 0;
    const service = new TeacherStudentQueryService({
      organizationRepository,
      taskRepository,
      clock: { nowIso: () => '2026-09-16T08:00:00.000+08:00' },
      requestIds: { next: () => `request_${++requestSequence}` },
      cursorCodec: {
        encode: (value) => `test.${encodeURIComponent(value)}`,
        decode: (value) => value.startsWith('test.') ? decodeURIComponent(value.slice(5)) : null,
      },
    });

    await expect(service.listStudents(teacherActor, { status: 'all' }, { limit: 20 })).resolves.toMatchObject({
      ok: true,
      data: {
        classes: [{ id: CLASS_ID }],
        total: 1,
        items: [{ studentId: STUDENT_ID, displayName: '虚构学生', performance: { assignedCount: 0 } }],
      },
    });
    await expect(service.getStudent(teacherActor, STUDENT_ID)).resolves.toMatchObject({
      ok: true,
      data: {
        studentId: STUDENT_ID,
        parents: [{ displayNameMasked: '虚构家*', mobileMasked: '138****0000' }],
      },
    });
  });

  it('returns deep copies for nested resource, grant and role data', async () => {
    const repository = createOrgContentDocumentRepository(seededDatabase());
    const reading = await repository.findLearningResource(ORGANIZATION_ID, 'reading_published');
    const grant = (await repository.listActiveTeacherGrants(ORGANIZATION_ID, TEACHER_ID))[0];
    const role = (await repository.listRoleAssignments(ORGANIZATION_ID, STUDENT_ID))[0];
    if (reading?.type !== 'reading' || grant === undefined || role === undefined) throw new Error('fixture missing');

    ((reading as ReadingResourceEntity).chapters[0]?.pages[0]?.bodyBlocks as string[]).push('mutated');
    (grant.permissions as string[]).push('content.read');
    ((role as RoleAssignmentEntity).scopeIds as string[]).push('class_mutated');

    const secondReading = await repository.findLearningResource(ORGANIZATION_ID, 'reading_published');
    expect(secondReading?.type === 'reading' ? secondReading.chapters[0]?.pages[0]?.bodyBlocks : null)
      .toEqual(['private body']);
    await expect(repository.listActiveTeacherGrants(ORGANIZATION_ID, TEACHER_ID)).resolves.toEqual([
      expect.objectContaining({ permissions: ['student.read'] }),
    ]);
    expect((await repository.listRoleAssignments(ORGANIZATION_ID, STUDENT_ID))[0]?.scopeIds).toEqual([STUDENT_ID]);
  });

  it('supports transaction-scoped writes with create/update CAS', async () => {
    const repository = createOrgContentDocumentRepository(seededDatabase());
    await repository.transaction(async (transaction) => transaction.saveClass({
      id: 'class_created', organizationId: ORGANIZATION_ID, name: '虚构新班', grade: '四年级',
      term: '上学期', status: 'active', version: 1,
    }));
    await expect(repository.findClass(ORGANIZATION_ID, 'class_created')).resolves.toMatchObject({ version: 1 });
    await repository.transaction(async (transaction) => transaction.saveClass({
      id: 'class_created', organizationId: ORGANIZATION_ID, name: '虚构新班', grade: '四年级',
      term: '下学期', status: 'active', version: 2,
    }));
    await expect(repository.transaction(async (transaction) => transaction.saveClass({
      id: 'class_created', organizationId: ORGANIZATION_ID, name: '过期写入', grade: '四年级',
      term: '下学期', status: 'active', version: 2,
    }))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

function seededDatabase(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [ORG_CONTENT_COLLECTIONS.organizations]: [
      document(ORGANIZATION_ID, ORGANIZATION_ID, { name: '虚构学校', status: 'active', timeZone: 'Asia/Shanghai' }),
    ],
    [ORG_CONTENT_COLLECTIONS.classes]: [
      document(CLASS_ID, ORGANIZATION_ID, { name: '虚构三年级 2 班', grade: 3, term: '上学期', status: 'active' }),
      document('class_other_tenant', OTHER_ORGANIZATION_ID, { name: '他组织班级', grade: '三年级', term: '上学期', status: 'active' }),
    ],
    [ORG_CONTENT_COLLECTIONS.users]: [
      document(STUDENT_ID, ORGANIZATION_ID, {
        authorizationVersion: 1, displayName: '虚构学生', displayNameMasked: '虚构学*', studentNumber: 'DEMO-001', status: 'active',
      }),
      document(PARENT_ID, ORGANIZATION_ID, {
        authorizationVersion: 1, displayName: '虚构家长', displayNameMasked: '虚构家*', mobileMasked: '138****0000', status: 'active',
      }),
      document('student_other_tenant', OTHER_ORGANIZATION_ID, {
        authorizationVersion: 1, displayName: '他组织学生', displayNameMasked: '他组织*', status: 'active',
      }),
    ],
    [ORG_CONTENT_COLLECTIONS.memberships]: [
      document('membership_active', ORGANIZATION_ID, { classId: CLASS_ID, studentId: STUDENT_ID, status: 'active' }),
      document('membership_inactive', ORGANIZATION_ID, { classId: CLASS_ID, studentId: STUDENT_ID, status: 'inactive' }),
      deletedDocument('membership_deleted', ORGANIZATION_ID, { classId: CLASS_ID, studentId: STUDENT_ID, status: 'active' }),
      document('membership_other', OTHER_ORGANIZATION_ID, { classId: CLASS_ID, studentId: STUDENT_ID, status: 'active' }),
    ],
    [ORG_CONTENT_COLLECTIONS.roles]: [
      roleDocument('role_student_active', STUDENT_ID, 'student', 'active', [STUDENT_ID]),
      roleDocument('role_student_revoked', STUDENT_ID, 'teacher', 'revoked', [CLASS_ID]),
      roleDocument('role_parent_active', PARENT_ID, 'parent', 'active', [PARENT_ID]),
      deletedDocument('role_student_deleted', ORGANIZATION_ID, roleFields(STUDENT_ID, 'admin', 'active', [ORGANIZATION_ID])),
    ],
    [ORG_CONTENT_COLLECTIONS.teacherGrants]: [
      document('grant_active', ORGANIZATION_ID, grantFields('active')),
      document('grant_revoked', ORGANIZATION_ID, grantFields('revoked')),
      deletedDocument('grant_deleted', ORGANIZATION_ID, grantFields('active')),
      document('grant_other', OTHER_ORGANIZATION_ID, grantFields('active')),
    ],
    [ORG_CONTENT_COLLECTIONS.parentLinks]: [
      document('link_active', ORGANIZATION_ID, linkFields('active')),
      document('link_revoked', ORGANIZATION_ID, linkFields('revoked')),
      deletedDocument('link_deleted', ORGANIZATION_ID, linkFields('active')),
    ],
    [ORG_CONTENT_COLLECTIONS.resources]: [
      document('reading_published', ORGANIZATION_ID, readingFields('published')),
      document('reading_offline', ORGANIZATION_ID, readingFields('offline')),
      deletedDocument('reading_deleted', ORGANIZATION_ID, readingFields('published')),
      document('reading_other', OTHER_ORGANIZATION_ID, readingFields('published')),
      document('vocabulary_published', ORGANIZATION_ID, vocabularyFields()),
    ],
    [ORG_CONTENT_COLLECTIONS.organizationAudits]: [
      document('audit_local', ORGANIZATION_ID, {
        requestId: 'req_audit_local', actorUserId: 'admin_demo', actorRole: 'admin',
        action: 'role.assigned', targetType: 'role_assignment', targetId: 'role_student_active',
        result: 'succeeded', errorCode: null, occurredAt: '2026-09-16T08:00:00.000Z',
        metadata: { classId: CLASS_ID, reason: 'stored but not projected here' },
      }),
      document('audit_other', OTHER_ORGANIZATION_ID, {
        requestId: 'req_audit_other', actorUserId: 'admin_other', actorRole: 'admin',
        action: 'role.assigned', targetType: 'role_assignment', targetId: 'role_other',
        result: 'succeeded', errorCode: null, occurredAt: '2026-09-16T08:00:00.000Z', metadata: {},
      }),
    ],
  });
}

function document(
  id: string,
  organizationId: string,
  fields: Readonly<Record<string, VersionedDocument[string]>>,
): VersionedDocument {
  return { _id: id, organizationId, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}

function deletedDocument(
  id: string,
  organizationId: string,
  fields: Readonly<Record<string, VersionedDocument[string]>>,
): VersionedDocument {
  return { ...document(id, organizationId, fields), deletedAt: '2026-09-16T00:00:00.000Z' };
}

function roleDocument(
  id: string,
  userId: string,
  role: 'student' | 'parent' | 'teacher' | 'admin',
  status: 'active' | 'revoked',
  scopeIds: readonly string[],
): VersionedDocument {
  return document(id, ORGANIZATION_ID, roleFields(userId, role, status, scopeIds));
}

function roleFields(
  userId: string,
  role: 'student' | 'parent' | 'teacher' | 'admin',
  status: 'active' | 'revoked',
  scopeIds: readonly string[],
) {
  return {
    userId, role, status, permissions: role === 'student' ? ['content.read', 'task.read.self'] : [],
    scopeType: 'self', scopeIds, grantedBy: 'admin_demo', grantedAt: '2026-09-16T00:00:00.000Z',
  } as const;
}

function grantFields(status: 'active' | 'revoked') {
  return {
    teacherId: TEACHER_ID, classId: CLASS_ID, permissions: ['student.read'], status,
    grantedBy: 'admin_demo', grantedAt: '2026-09-16T00:00:00.000Z',
  } as const;
}

function linkFields(status: 'active' | 'revoked') {
  return {
    parentId: PARENT_ID, studentId: STUDENT_ID, status,
    confirmedBy: 'admin_demo', confirmedAt: '2026-09-16T00:00:00.000Z',
  } as const;
}

function readingFields(status: 'published' | 'offline') {
  return {
    type: 'reading', title: '虚构绘本', contentVersion: 'demo-v1', status,
    visibilityScope: { classIds: [CLASS_ID] }, copyrightStatus: 'demo',
    payload: {
      category: 'picture_book', grade: '三年级', difficulty: '基础', searchText: 'private search',
      chapters: [{
        id: 'chapter_1', title: '虚构章节', order: 1,
        pages: [{
          id: 'page_1', pageNumber: 1, order: 1, thumbnailAssetKey: 'demo/thumb-1',
          imageAssetKey: 'demo/page-1', width: 1600, height: 1200, assetVersion: 'demo-v1',
          ocrText: 'private OCR', bodyBlocks: ['private body'],
        }],
      }],
    },
  } as const;
}

function vocabularyFields() {
  return {
    type: 'vocabulary', title: '虚构单词包', contentVersion: 1, status: 'published',
    visibility: { type: 'classes', classIds: [CLASS_ID] }, copyrightStatus: 'demo',
    grade: '三年级', unit: 'Unit Demo',
    words: [{ id: 'word_demo', word: 'demo', meaning: '示例', example: 'A demo.', syllables: ['de', 'mo'] }],
  } as const;
}
