import { afterEach, describe, expect, it } from 'vitest';
import { createContentQueryFunction } from '../../functions/content-query/function-entry';
import { createOrganizationAdminFunction } from '../../functions/organization-admin/function-entry';
import { createRelationshipCommandFunction } from '../../functions/relationship-command/function-entry';
import {
  createDefaultCloudBaseFunction,
  createDefaultCloudBaseContentQueryFunction,
  createDefaultCloudBaseTeacherStudentQueryFunction,
  installCloudBaseRuntimeProvider,
  type CloudBaseFunctionRuntimeCapabilities,
} from '../../functions/shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../../functions/shared/unconfigured-function';
import { createTeacherStudentQueryFunction } from '../../functions/teacher-student-query/function-entry';
import {
  CONTENT_QUERY_ACTIONS,
  ORGANIZATION_ADMIN_ACTIONS,
  RELATIONSHIP_COMMAND_ACTIONS,
  validateContentQueryRequest,
  validateOrganizationAdminRequest,
  validateRelationshipCommandRequest,
} from '../../src/contracts/org-content-functions';
import { OrganizationService } from '../../src/org-content/organization-service';
import { RelationshipService } from '../../src/org-content/relationship-service';
import {
  TEACHER_STUDENT_QUERY_ACTIONS,
  validateTeacherStudentQueryRequest,
} from '../../src/contracts/teacher-student-functions';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { ORG_CONTENT_COLLECTIONS } from '../../src/repositories/org-content-document-adapter';
import { createOrgContentDocumentPersistence } from '../../src/repositories/org-content-document-adapter';
import {
  InMemoryBusinessSessionRepository,
  InMemoryIdentityRepository,
  type AuthorizationFixture,
} from '../../src/runtime/memory-ports';
import type { CursorCodec } from '../../src/task-query/types';
import { NativeDatabaseDouble } from '../support/native-database-double';

const ORGANIZATION_ID = 'org_demo';
const CLASS_ID = 'class_demo';
const STUDENT_ID = 'student_demo';
const TEACHER_ID = 'teacher_demo';
const NOW = '2026-09-16T08:00:00.000+08:00';

afterEach(() => installCloudBaseRuntimeProvider(null));

describe('default persistent organization/content query composition', () => {
  it('automatically builds content-query from the shared document capability', async () => {
    installCloudBaseRuntimeProvider((functionName) => {
      expect(functionName).toBe('content-query');
      return capabilities('student', true);
    });

    await expect(createContentDefault()({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {},
      businessSessionToken: 'opaque.student.token',
    })).resolves.toMatchObject({
      ok: true,
      data: [{ id: 'reading_demo', title: '虚构绘本' }],
    });
  });

  it('automatically builds teacher-student-query over org-content and task read repositories', async () => {
    installCloudBaseRuntimeProvider((functionName) => {
      expect(functionName).toBe('teacher-student-query');
      return capabilities('teacher', true);
    });

    await expect(createTeacherStudentDefault()({
      apiVersion: 'm1.v1', action: 'listStudents',
      payload: { filters: { status: 'all' }, page: { limit: 20 } },
      businessSessionToken: 'opaque.teacher.token',
    })).resolves.toMatchObject({
      ok: true,
      data: {
        classes: [{ id: CLASS_ID }],
        total: 1,
        items: [{ studentId: STUDENT_ID, displayName: '虚构学生', performance: { assignedCount: 0 } }],
      },
    });
  });

  it('fails closed when teacher cursor signing or the document database capability is unavailable', async () => {
    installCloudBaseRuntimeProvider(() => {
      const configured = capabilities('teacher', true);
      const { queryCursorCodec: _queryCursorCodec, ...withoutCodec } = configured;
      return withoutCodec;
    });
    await expect(createTeacherStudentDefault()({
      apiVersion: 'm1.v1', action: 'listStudents',
      payload: { filters: { status: 'all' }, page: { limit: 20 } },
      businessSessionToken: 'opaque.teacher.token',
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });

    installCloudBaseRuntimeProvider(() => {
      const configured = capabilities('student', false);
      const { documents: _documents, ...withoutDocuments } = configured;
      return {
        ...withoutDocuments,
        sdk: {
          getWXContext: configured.sdk.getWXContext,
          database: () => { throw new Error('database capability unavailable'); },
        },
      };
    });
    await expect(createContentDefault()({
      apiVersion: 'm1.v1', action: 'listReadingResources', payload: {},
      businessSessionToken: 'opaque.student.token',
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('automatically builds both command handlers and fails closed without sensitive relationship capabilities', async () => {
    installCloudBaseRuntimeProvider(() => capabilities('admin', true));
    await expect(createOrganizationDefault()({
      apiVersion: 'm1.v1', action: 'createClass',
      payload: { name: '虚构四年级 1 班', grade: '四年级', term: '上学期', reason: '默认组合测试' },
      expectedVersion: 1, operationId: 'operation_default_create_class',
      businessSessionToken: 'opaque.admin.token',
    })).resolves.toMatchObject({ ok: true, data: { name: '虚构四年级 1 班', version: 1 } });

    installCloudBaseRuntimeProvider(() => capabilities('admin', true));
    await expect(createRelationshipDefault()({
      apiVersion: 'm1.v1', action: 'issueBindingCode', payload: { studentId: STUDENT_ID },
      operationId: 'operation_default_issue', businessSessionToken: 'opaque.admin.token',
    })).resolves.toMatchObject({ ok: true, data: { code: expect.stringMatching(/^\d{6}$/) } });

    installCloudBaseRuntimeProvider(() => {
      const configured = capabilities('admin', true);
      const { bindingCodes: _bindingCodes, ...missingCodes } = configured;
      return missingCodes;
    });
    await expect(createRelationshipDefault()({
      apiVersion: 'm1.v1', action: 'issueBindingCode', payload: { studentId: STUDENT_ID },
      operationId: 'operation_missing_codes', businessSessionToken: 'opaque.admin.token',
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});

function createContentDefault() {
  const unavailable = createUnconfiguredFunction(
    'content-query',
    CONTENT_QUERY_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateContentQueryRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseContentQueryFunction(
    unavailable,
    (_capabilities, infrastructure) => createContentQueryFunction({
      ...infrastructure,
      handler: infrastructure.handler,
    }),
  );
}

function createTeacherStudentDefault() {
  const unavailable = createUnconfiguredFunction(
    'teacher-student-query',
    TEACHER_STUDENT_QUERY_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateTeacherStudentQueryRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseTeacherStudentQueryFunction(
    unavailable,
    (_capabilities, infrastructure) => createTeacherStudentQueryFunction({
      ...infrastructure,
      handler: infrastructure.handler,
    }),
  );
}

function createOrganizationDefault() {
  const unavailable = createUnconfiguredFunction(
    'organization-admin', ORGANIZATION_ADMIN_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateOrganizationAdminRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseFunction('organization-admin', unavailable, (configured, infrastructure) => {
    const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
    return createOrganizationAdminFunction({
      ...infrastructure,
      handler: new OrganizationService(
        persistence.repository, infrastructure.clock, configured.identifiers, persistence.idempotency,
      ),
    });
  });
}

function createRelationshipDefault() {
  const unavailable = createUnconfiguredFunction(
    'relationship-command', RELATIONSHIP_COMMAND_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateRelationshipCommandRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseFunction('relationship-command', unavailable, (configured, infrastructure) => {
    if (configured.bindingCodes === undefined || configured.bindingCodeDigest === undefined) {
      throw new Error('missing relationship capability');
    }
    const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
    return createRelationshipCommandFunction({
      ...infrastructure,
      handler: new RelationshipService(
        persistence.repository, infrastructure.clock, configured.identifiers,
        configured.bindingCodes, configured.bindingCodeDigest, persistence.idempotency,
      ),
    });
  });
}

function capabilities(
  role: 'student' | 'teacher' | 'admin',
  includeDocuments: boolean,
): CloudBaseFunctionRuntimeCapabilities {
  const userId = role === 'student' ? STUDENT_ID : role === 'teacher' ? TEACHER_ID : 'admin_demo';
  const uid = role === 'student' ? 'uid_student' : role === 'teacher' ? 'uid_teacher' : 'uid_admin';
  const token = role === 'student' ? 'opaque.student.token' : role === 'teacher' ? 'opaque.teacher.token' : 'opaque.admin.token';
  const sessionId = role === 'student' ? 'session_student' : role === 'teacher' ? 'session_teacher' : 'session_admin';
  const sessions = new InMemoryBusinessSessionRepository();
  void sessions.startOrResume({
    id: sessionId,
    organizationId: ORGANIZATION_ID,
    userId,
    subjectDigest: `digest:cloudbase:username:${uid}`,
    audience: role === 'admin' ? 'admin-console' : 'mini-program',
    role,
    authzVersion: 1,
    recordVersion: 1,
    expiresAt: '2099-09-17T00:00:00.000Z',
    revokedAt: null,
  }, NOW);
  return {
    sdk: { getWXContext: () => ({ UID: uid }), database: () => new NativeDatabaseDouble() },
    identities: new InMemoryIdentityRepository(identityFixture(role, uid)),
    sessions,
    subjectDigest: { digest: (value) => `digest:${value}` },
    identifiers: { next: (prefix) => `${prefix}_demo` },
    businessSession: { getBusinessSessionId: (candidate) => candidate === token ? sessionId : null },
    clock: { nowIso: () => NOW },
    requestIds: { next: () => 'request_demo' },
    queryCursorCodec: codec,
    bindingCodes: {
      nextSixDigits: () => '111111',
      deriveSixDigits: (seed) => String(100000 + seed.length).slice(-6),
    },
    bindingCodeDigest: { digest: (value) => `sha256_length_${value.length}` },
    ...(includeDocuments ? { documents: organizationDocuments() } : {}),
  };
}

function identityFixture(role: 'student' | 'teacher' | 'admin', uid: string): AuthorizationFixture {
  const userId = role === 'student' ? STUDENT_ID : role === 'teacher' ? TEACHER_ID : 'admin_demo';
  return {
    organizations: [{
      _id: ORGANIZATION_ID, organizationId: ORGANIZATION_ID, name: '虚构学校', status: 'active',
      timeZone: 'Asia/Shanghai', version: 1, deletedAt: null,
    }],
    users: [{
      _id: userId, organizationId: ORGANIZATION_ID, authorizationVersion: 1,
      displayName: role === 'student' ? '虚构学生' : role === 'teacher' ? '虚构教师' : '虚构管理员',
      displayNameMasked: '虚构*', status: 'active', version: 1, deletedAt: null,
    }],
    identities: [{
      _id: `identity_${role}`, organizationId: ORGANIZATION_ID, userId, provider: 'cloudbase_uid',
      providerSubjectDigest: `digest:cloudbase:username:${uid}`, status: 'active', version: 1, deletedAt: null,
    }],
    roles: [{
      _id: `role_${role}`, organizationId: ORGANIZATION_ID, userId, role, status: 'active',
      permissions: role === 'student' ? ['content.read'] : role === 'teacher' ? ['student.read'] : ['class.manage', 'student.bind-code.issue'],
      scopeIds: role === 'student' ? [STUDENT_ID] : role === 'teacher' ? [CLASS_ID] : [ORGANIZATION_ID, CLASS_ID],
      version: 1, deletedAt: null,
    }],
    teacherGrants: [],
    parentLinks: [],
  };
}

function organizationDocuments(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [ORG_CONTENT_COLLECTIONS.classes]: [document(CLASS_ID, {
      name: '虚构三年级 2 班', grade: 3, term: '上学期', status: 'active',
    })],
    [ORG_CONTENT_COLLECTIONS.users]: [document(STUDENT_ID, {
      authorizationVersion: 1, displayName: '虚构学生', displayNameMasked: '虚构学*', studentNumber: 'DEMO-001', status: 'active',
    })],
    [ORG_CONTENT_COLLECTIONS.roles]: [document('role_student_document', {
      userId: STUDENT_ID, role: 'student', status: 'active', permissions: ['content.read'],
      scopeType: 'self', scopeIds: [STUDENT_ID], grantedBy: 'admin_demo', grantedAt: NOW,
    })],
    [ORG_CONTENT_COLLECTIONS.memberships]: [document('membership_demo', {
      classId: CLASS_ID, studentId: STUDENT_ID, status: 'active',
    })],
    [ORG_CONTENT_COLLECTIONS.teacherGrants]: [document('grant_demo', {
      teacherId: TEACHER_ID, classId: CLASS_ID, permissions: ['student.read'], status: 'active',
      grantedBy: 'admin_demo', grantedAt: NOW,
    })],
    [ORG_CONTENT_COLLECTIONS.resources]: [document('reading_demo', {
      type: 'reading', title: '虚构绘本', contentVersion: 'demo-v1', status: 'published',
      visibilityScope: { classIds: [CLASS_ID] }, copyrightStatus: 'demo',
      payload: {
        category: 'picture_book', grade: '三年级', difficulty: '基础',
        chapters: [{
          id: 'chapter_demo', title: '虚构章节', order: 1,
          pages: [{
            id: 'page_demo', pageNumber: 1, order: 1, thumbnailAssetKey: 'demo/thumb',
            imageAssetKey: 'demo/page', width: 1600, height: 1200, assetVersion: 'demo-v1',
          }],
        }],
      },
    })],
  });
}

function document(id: string, fields: Readonly<Record<string, VersionedDocument[string]>>): VersionedDocument {
  return {
    _id: id, organizationId: ORGANIZATION_ID, schemaVersion: 1, version: 1, deletedAt: null, ...fields,
  };
}

const codec: CursorCodec = {
  encode: (value) => `signed.${encodeURIComponent(value)}`,
  decode: (value) => value.startsWith('signed.') ? decodeURIComponent(value.slice(7)) : null,
};
