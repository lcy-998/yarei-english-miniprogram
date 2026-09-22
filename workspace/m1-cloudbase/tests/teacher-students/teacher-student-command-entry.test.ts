import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTeacherStudentCommandFunction,
  main as unconfiguredTeacherStudentCommand,
} from '../../functions/teacher-student-command';
import type { TeacherStudentCommandHandler } from '../../functions/teacher-student-command/function-entry';
import {
  createDefaultCloudBaseFunction,
  installCloudBaseRuntimeProvider,
  type CloudBaseFunctionRuntimeCapabilities,
} from '../../functions/shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../../functions/shared/unconfigured-function';
import type { TrustedActorContext, TrustedActorResolver } from '../../src/auth/trusted-actor';
import {
  TEACHER_STUDENT_COMMAND_ACTIONS,
  validateTeacherStudentCommandRequest,
} from '../../src/contracts/teacher-student-functions';
import { OrgContentError } from '../../src/org-content/types';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import {
  ORG_CONTENT_COLLECTIONS,
  createOrgContentDocumentPersistence,
} from '../../src/repositories/org-content-document-adapter';
import {
  InMemoryBusinessSessionRepository,
  InMemoryIdentityRepository,
  type AuthorizationFixture,
} from '../../src/runtime/memory-ports';
import type { CloudBaseRuntimePort } from '../../src/runtime/ports';
import type { FunctionName } from '../../src/shared/protocol';
import { TeacherStudentCommandService } from '../../src/teacher-students/command-service';
import type {
  TeacherStudentMutationReceipt,
  TeacherStudentTransferReceipt,
} from '../../src/teacher-students/types';

const ORGANIZATION_ID = 'org_demo';
const TEACHER_ID = 'teacher_demo';
const STUDENT_ID = 'student_demo';
const SOURCE_CLASS_ID = 'class_three_two';
const TARGET_CLASS_ID = 'class_four_one';
const NOW = '2026-09-17T10:00:00.000+08:00';

const teacherActor: TrustedActorContext = {
  requestId: 'request_teacher_command',
  sessionId: 'session_teacher',
  actorUserId: TEACHER_ID,
  actorRole: 'teacher',
  organizationId: ORGANIZATION_ID,
  platformSubjectDigest: 'digest_teacher',
  permissions: ['student.read', 'student.manage'],
  scopeIds: [SOURCE_CLASS_ID, TARGET_CLASS_ID],
  authzVersion: 1,
};

const mutationReceipt: TeacherStudentMutationReceipt = {
  studentId: STUDENT_ID,
  displayName: '虚构学生',
  accountStatus: 'active',
  classId: SOURCE_CLASS_ID,
  userVersion: 8,
  membershipVersion: 3,
  classVersion: 4,
};

const transferReceipt: TeacherStudentTransferReceipt = {
  ...mutationReceipt,
  classId: TARGET_CLASS_ID,
  membershipVersion: 1,
  classVersion: 3,
  sourceClassId: SOURCE_CLASS_ID,
  sourceClassVersion: 5,
};

afterEach(() => installCloudBaseRuntimeProvider(null));

describe('M1 teacher-student-command 严格函数入口', () => {
  it('用可信 actor 分发三个 action，并将 expectedVersion/operationId 从顶层组装到命令', async () => {
    const handler = commandHandler();
    const boundary = createBoundary(teacherActor);
    const main = createTeacherStudentCommandFunction({ ...boundary, handler });

    await expect(main(updateProfileRequest())).resolves.toMatchObject({
      ok: true,
      data: { studentId: STUDENT_ID, userVersion: 8 },
    });
    expect(handler.updateProfile).toHaveBeenCalledWith(teacherActor, {
      studentId: STUDENT_ID,
      classId: SOURCE_CLASS_ID,
      displayName: '虚构新姓名',
      expectedUserVersion: 7,
      expectedMembershipVersion: 3,
      reason: '更正虚构资料',
      operationId: 'operation_profile_0001',
    });

    await expect(main({
      apiVersion: 'm1.v1',
      action: 'setStatus',
      payload: {
        studentId: STUDENT_ID,
        classId: SOURCE_CLASS_ID,
        status: 'disabled',
        expectedMembershipVersion: 3,
        expectedClassVersion: 4,
        reason: '暂停虚构账号',
      },
      expectedVersion: 7,
      operationId: 'operation_status_0001',
    })).resolves.toMatchObject({ ok: true });
    expect(handler.setStatus).toHaveBeenCalledWith(teacherActor, expect.objectContaining({
      expectedUserVersion: 7,
      operationId: 'operation_status_0001',
      status: 'disabled',
    }));

    await expect(main({
      apiVersion: 'm1.v1',
      action: 'transfer',
      payload: {
        studentId: STUDENT_ID,
        sourceClassId: SOURCE_CLASS_ID,
        targetClassId: TARGET_CLASS_ID,
        expectedMembershipVersion: 3,
        expectedTargetMembershipVersion: 0,
        expectedSourceClassVersion: 4,
        expectedTargetClassVersion: 2,
        reason: '调整虚构班级',
      },
      expectedVersion: 7,
      operationId: 'operation_transfer_0001',
    })).resolves.toMatchObject({ ok: true, data: { sourceClassId: SOURCE_CLASS_ID } });
    expect(handler.transfer).toHaveBeenCalledWith(teacherActor, expect.objectContaining({
      expectedUserVersion: 7,
      expectedTargetMembershipVersion: 0,
      operationId: 'operation_transfer_0001',
    }));
    expect(boundary.actorResolver.resolve).toHaveBeenCalledWith(
      { subject: 'trusted-platform-subject', loginType: 'USERNAME', isAuthenticated: true },
      'teacher-student-command',
      'session_from_runtime',
    );
  });

  it('在解析身份前拒绝客户端 actor、组织、权限和版本/幂等字段注入', async () => {
    const injectedFields = ['actorUserId', 'actorRole', 'organizationId', 'permissions', 'scopeIds'] as const;
    for (const field of injectedFields) {
      const boundary = createBoundary(teacherActor);
      const handler = commandHandler();
      const main = createTeacherStudentCommandFunction({ ...boundary, handler });
      const request = updateProfileRequest();
      const result = await main({ ...request, payload: { ...request.payload, [field]: field === 'permissions' ? ['student.manage'] : 'forged' } });
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { [field]: expect.any(String) } } });
      expect(boundary.actorResolver.resolve).not.toHaveBeenCalled();
      expect(handler.updateProfile).not.toHaveBeenCalled();
    }

    const payloadVersion = updateProfileRequest();
    expect(await createTeacherStudentCommandFunction({ ...createBoundary(teacherActor), handler: commandHandler() })({
      ...payloadVersion,
      payload: { ...payloadVersion.payload, expectedVersion: 7 },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { expectedVersion: expect.any(String) } } });
    expect(await createTeacherStudentCommandFunction({ ...createBoundary(teacherActor), handler: commandHandler() })({
      ...payloadVersion,
      payload: { ...payloadVersion.payload, operationId: 'operation_in_payload' },
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } } });
    expect(await createTeacherStudentCommandFunction({ ...createBoundary(teacherActor), handler: commandHandler() })({
      ...payloadVersion,
      actorRole: 'admin',
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fieldErrors: { actorRole: expect.any(String) } } });
  });

  it('缺失顶层 expectedVersion/operationId、无可信 actor 或错误 transfer 版本时失败关闭', async () => {
    const handler = commandHandler();
    const boundary = createBoundary(teacherActor);
    const main = createTeacherStudentCommandFunction({ ...boundary, handler });
    const request = updateProfileRequest();
    const { expectedVersion: _expectedVersion, ...withoutVersion } = request;
    expect(await main(withoutVersion)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { expectedVersion: expect.any(String) } },
    });
    const { operationId: _operationId, ...withoutOperation } = request;
    expect(await main(withoutOperation)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { operationId: expect.any(String) } },
    });
    expect(boundary.actorResolver.resolve).not.toHaveBeenCalled();

    const unauthenticatedHandler = commandHandler();
    expect(await createTeacherStudentCommandFunction({ ...createBoundary(null), handler: unauthenticatedHandler })(request))
      .toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(unauthenticatedHandler.updateProfile).not.toHaveBeenCalled();

    expect(await main({
      apiVersion: 'm1.v1', action: 'transfer',
      payload: {
        studentId: STUDENT_ID,
        sourceClassId: SOURCE_CLASS_ID,
        targetClassId: TARGET_CLASS_ID,
        expectedMembershipVersion: 3,
        expectedTargetMembershipVersion: -1,
        expectedSourceClassVersion: 4,
        expectedTargetClassVersion: 2,
        reason: '非法版本',
      },
      expectedVersion: 7,
      operationId: 'operation_transfer_bad_version',
    })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { expectedTargetMembershipVersion: expect.any(String) } },
    });
  });

  it('只映射受控领域错误，未知内部异常不泄漏', async () => {
    const forbidden = commandHandler();
    forbidden.updateProfile = vi.fn(async () => { throw new OrgContentError('FORBIDDEN'); });
    expect(await createTeacherStudentCommandFunction({ ...createBoundary(teacherActor), handler: forbidden })(updateProfileRequest()))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN', retryable: false } });

    const unknown = commandHandler();
    unknown.updateProfile = vi.fn(async () => { throw new Error('private database detail'); });
    const result = await createTeacherStudentCommandFunction({ ...createBoundary(teacherActor), handler: unknown })(updateProfileRequest());
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: true } });
    expect(JSON.stringify(result)).not.toContain('private database detail');
  });

  it('未配置默认入口对合法请求返回 SERVICE_UNAVAILABLE，同时仍优先拒绝非法 schema', async () => {
    await expect(unconfiguredTeacherStudentCommand(updateProfileRequest())).resolves.toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    await expect(unconfiguredTeacherStudentCommand({
      ...updateProfileRequest(),
      payload: { ...updateProfileRequest().payload, organizationId: 'org_forged' },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR', fieldErrors: { organizationId: expect.any(String) } },
    });
  });
});

describe('M1 teacher-student-command 默认持久化组合', () => {
  it('自动组合文档事务、幂等和审计，跨冷启动重放不重复写入', async () => {
    const database = commandDocuments();
    installCloudBaseRuntimeProvider(() => capabilities(database));
    const first = createPersistentDefault();
    const firstResult = await first({ ...updateProfileRequest(), businessSessionToken: 'opaque.teacher.token' });
    expect(firstResult).toMatchObject({ ok: true, data: { displayName: '虚构新姓名', userVersion: 8 } });

    installCloudBaseRuntimeProvider(() => capabilities(database));
    const coldStart = createPersistentDefault();
    await expect(coldStart({ ...updateProfileRequest(), businessSessionToken: 'opaque.teacher.token' }))
      .resolves.toEqual(firstResult);
    const snapshot = database.snapshot();
    expect(snapshot[ORG_CONTENT_COLLECTIONS.users]).toEqual([
      expect.objectContaining({ _id: STUDENT_ID, displayName: '虚构新姓名', version: 8 }),
    ]);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.idempotency]).toHaveLength(1);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.organizationAudits]).toEqual([
      expect.objectContaining({ action: 'student.profile.updated', result: 'succeeded' }),
    ]);
  });

  it('缺少文档数据库能力时失败关闭且不调用业务 handler', async () => {
    const configured = capabilities(commandDocuments());
    const { documents: _documents, ...withoutDocuments } = configured;
    installCloudBaseRuntimeProvider(() => ({
      ...withoutDocuments,
      sdk: {
        getWXContext: configured.sdk.getWXContext,
        database: () => { throw new Error('database unavailable'); },
      },
    }));
    await expect(createPersistentDefault()({
      ...updateProfileRequest(), businessSessionToken: 'opaque.teacher.token',
    })).resolves.toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});

function commandHandler(): TeacherStudentCommandHandler {
  return {
    updateProfile: vi.fn(async () => mutationReceipt),
    setStatus: vi.fn(async () => ({ ...mutationReceipt, accountStatus: 'disabled', userVersion: 8 })),
    transfer: vi.fn(async () => transferReceipt),
  };
}

function createBoundary(actor: TrustedActorContext | null) {
  let requestSequence = 0;
  const runtime: CloudBaseRuntimePort = {
    functionName: 'teacher-student-command',
    getPlatformSubject: vi.fn(async () => ({
      subject: 'trusted-platform-subject',
      loginType: 'USERNAME' as const,
      isAuthenticated: true,
    })),
    getBusinessSessionId: vi.fn(async () => 'session_from_runtime'),
  };
  const actorResolver: TrustedActorResolver = { resolve: vi.fn(async () => actor) };
  return {
    runtime,
    actorResolver,
    clock: { nowIso: (): string => NOW },
    requestIds: { next: (): string => `request_${++requestSequence}` },
  };
}

function updateProfileRequest() {
  return {
    apiVersion: 'm1.v1',
    action: 'updateProfile',
    payload: {
      studentId: STUDENT_ID,
      classId: SOURCE_CLASS_ID,
      displayName: '虚构新姓名',
      expectedMembershipVersion: 3,
      reason: '更正虚构资料',
    },
    expectedVersion: 7,
    operationId: 'operation_profile_0001',
  } as const;
}

function createPersistentDefault() {
  const unavailable = createUnconfiguredFunction(
    'teacher-student-command',
    TEACHER_STUDENT_COMMAND_ACTIONS,
    (_action, _payload, request) => {
      const validated = validateTeacherStudentCommandRequest(request);
      return validated.ok ? null : validated.fieldErrors;
    },
  );
  return createDefaultCloudBaseFunction(
    'teacher-student-command',
    unavailable,
    (configured, infrastructure) => {
      const persistence = createOrgContentDocumentPersistence(infrastructure.documents);
      return createTeacherStudentCommandFunction({
        ...infrastructure,
        handler: new TeacherStudentCommandService(
          persistence.repository,
          infrastructure.clock,
          configured.identifiers,
          persistence.idempotency,
        ),
      });
    },
  );
}

function capabilities(database: FakeDocumentDatabase): CloudBaseFunctionRuntimeCapabilities {
  const sessions = new InMemoryBusinessSessionRepository();
  void sessions.startOrResume({
    id: 'session_teacher',
    organizationId: ORGANIZATION_ID,
    userId: TEACHER_ID,
    subjectDigest: 'digest:cloudbase:username:uid_teacher',
    role: 'teacher',
    authzVersion: 1,
    recordVersion: 1,
    expiresAt: '2099-09-17T00:00:00.000Z',
    revokedAt: null,
  }, NOW);
  return {
    sdk: { getWXContext: () => ({ UID: 'uid_teacher' }), database: () => { throw new Error('unused native database'); } },
    identities: new InMemoryIdentityRepository(identityFixture()),
    sessions,
    subjectDigest: { digest: (value) => `digest:${value}` },
    identifiers: { next: (prefix) => `${prefix}_entry` },
    documents: database,
    businessSession: { getBusinessSessionId: (token) => token === 'opaque.teacher.token' ? 'session_teacher' : null },
    clock: { nowIso: () => NOW },
    requestIds: { next: () => 'request_persistent_command' },
  };
}

function identityFixture(): AuthorizationFixture {
  return {
    organizations: [{
      _id: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      name: '虚构学校',
      status: 'active',
      timeZone: 'Asia/Shanghai',
      version: 1,
      deletedAt: null,
    }],
    users: [{
      _id: TEACHER_ID,
      organizationId: ORGANIZATION_ID,
      authorizationVersion: 1,
      displayName: '虚构教师',
      displayNameMasked: '虚构*',
      status: 'active',
      version: 1,
      deletedAt: null,
    }],
    identities: [{
      _id: 'identity_teacher',
      organizationId: ORGANIZATION_ID,
      userId: TEACHER_ID,
      provider: 'cloudbase_uid',
      providerSubjectDigest: 'digest:cloudbase:username:uid_teacher',
      status: 'active',
      version: 1,
      deletedAt: null,
    }],
    roles: [{
      _id: 'role_teacher',
      organizationId: ORGANIZATION_ID,
      userId: TEACHER_ID,
      role: 'teacher',
      status: 'active',
      permissions: ['student.read', 'student.manage'],
      scopeIds: [SOURCE_CLASS_ID, TARGET_CLASS_ID],
      version: 1,
      deletedAt: null,
    }],
    teacherGrants: [],
    parentLinks: [],
  };
}

function commandDocuments(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [ORG_CONTENT_COLLECTIONS.classes]: [
      document(SOURCE_CLASS_ID, { name: '三年级 2 班', grade: '三年级', term: '上学期', status: 'active' }, 4),
      document(TARGET_CLASS_ID, { name: '四年级 1 班', grade: '四年级', term: '上学期', status: 'active' }, 2),
    ],
    [ORG_CONTENT_COLLECTIONS.users]: [document(STUDENT_ID, {
      authorizationVersion: 1,
      displayName: '虚构学生',
      displayNameMasked: '虚构*',
      studentNumber: 'DEMO-001',
      status: 'active',
    }, 7)],
    [ORG_CONTENT_COLLECTIONS.roles]: [document('role_student', {
      userId: STUDENT_ID,
      role: 'student',
      status: 'active',
      permissions: ['content.read'],
      scopeType: 'self',
      scopeIds: [STUDENT_ID],
      grantedBy: 'admin_demo',
      grantedAt: NOW,
    })],
    [ORG_CONTENT_COLLECTIONS.memberships]: [document('membership_student', {
      classId: SOURCE_CLASS_ID,
      studentId: STUDENT_ID,
      status: 'active',
      joinedAt: NOW,
    }, 3)],
    [ORG_CONTENT_COLLECTIONS.teacherGrants]: [document('grant_teacher', {
      teacherId: TEACHER_ID,
      classId: SOURCE_CLASS_ID,
      permissions: ['student.read', 'student.manage'],
      status: 'active',
      grantedBy: 'admin_demo',
      grantedAt: NOW,
    })],
  });
}

function document(
  id: string,
  fields: Readonly<Record<string, VersionedDocument[string]>>,
  version = 1,
): VersionedDocument {
  return {
    _id: id,
    organizationId: ORGANIZATION_ID,
    schemaVersion: 1,
    version,
    deletedAt: null,
    ...fields,
  };
}
