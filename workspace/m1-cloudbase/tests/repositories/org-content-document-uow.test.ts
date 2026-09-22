import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { OrganizationService } from '../../src/org-content/organization-service';
import { RelationshipService } from '../../src/org-content/relationship-service';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import {
  ORG_CONTENT_COLLECTIONS,
  createOrgContentDocumentRepository,
  createOrgContentDocumentPersistence,
} from '../../src/repositories/org-content-document-adapter';
import type { VersionedDocument } from '../../src/repositories/document-database-port';

const ORGANIZATION_ID = 'org_demo';
const CLASS_ID = 'class_demo';
const STUDENT_ID = 'student_demo';
const NOW = '2026-09-16T08:00:00.000+08:00';

const admin: TrustedActorContext = {
  requestId: 'request_admin', sessionId: 'session_admin', actorUserId: 'admin_demo', actorRole: 'admin',
  organizationId: ORGANIZATION_ID, platformSubjectDigest: 'digest_admin',
  permissions: ['class.manage', 'student.bind-code.issue'], scopeIds: [ORGANIZATION_ID, CLASS_ID], authzVersion: 1,
};

describe('org-content document atomic UnitOfWork', () => {
  it('commits mutation, idempotency result and audit once, then replays the stored result', async () => {
    const database = databaseWithStudent();
    const { repository, idempotency } = createOrgContentDocumentPersistence(database);
    const service = new OrganizationService(repository, clock, identifiers(), idempotency);
    const command = {
      name: '虚构四年级 1 班', grade: '四年级', term: '上学期', reason: '本地原子测试',
      expectedVersion: 1 as const, operationId: 'operation_create_class',
    };

    const first = await service.createClass(admin, command);
    const replay = await service.createClass(admin, command);
    expect(replay).toEqual(first);
    const snapshot = database.snapshot();
    expect(snapshot[ORG_CONTENT_COLLECTIONS.classes]?.filter((item) => item.name === command.name)).toHaveLength(1);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.idempotency]).toEqual([
      expect.objectContaining({ status: 'succeeded', action: 'createClass', version: 2 }),
    ]);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.organizationAudits]).toEqual([{
      _id: `audit:${ORGANIZATION_ID}:${admin.requestId}`,
      organizationId: ORGANIZATION_ID,
      schemaVersion: 1,
      version: 1,
      deletedAt: null,
      id: `audit:${ORGANIZATION_ID}:${admin.requestId}`,
      requestId: admin.requestId,
      actorUserId: admin.actorUserId,
      actorRole: 'admin',
      action: 'class.created',
      targetType: 'class',
      targetId: 'cls_1',
      result: 'succeeded',
      errorCode: null,
      metadata: { classId: 'cls_1', reasonProvided: true, reasonLength: command.reason.length },
      occurredAt: NOW,
    }]);
    const conflictActor = { ...admin, requestId: 'request_admin_conflict' };
    await expect(service.createClass(conflictActor, { ...command, name: '冲突班级' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.snapshot()[ORG_CONTENT_COLLECTIONS.organizationAudits]?.at(-1))
      .toMatchObject({
        _id: `audit:${ORGANIZATION_ID}:${conflictActor.requestId}`,
        requestId: conflictActor.requestId,
        actorRole: 'admin',
        action: 'class.created',
        targetType: 'class',
        targetId: 'new',
        result: 'denied',
        errorCode: 'CONFLICT',
        metadata: { reasonProvided: true, reasonLength: command.reason.length },
      });
  });

  it('rolls back business data, success audit and operation record, then records the infrastructure failure', async () => {
    const database = databaseWithStudent();
    const { repository, idempotency } = createOrgContentDocumentPersistence(database);
    const service = new OrganizationService(repository, clock, identifiers(), idempotency);
    database.failNext({ operation: 'append', collection: ORG_CONTENT_COLLECTIONS.organizationAudits, kind: 'unavailable' });

    await expect(service.createClass(admin, {
      name: '必须回滚的班级', grade: '五年级', term: '上学期', reason: '故障注入',
      expectedVersion: 1, operationId: 'operation_rollback',
    })).rejects.toMatchObject({ kind: 'unavailable' });
    const serialized = JSON.stringify(database.snapshot());
    expect(serialized).not.toContain('必须回滚的班级');
    expect(serialized).not.toContain('operation_rollback');
    expect(database.snapshot()[ORG_CONTENT_COLLECTIONS.organizationAudits]).toEqual([
      expect.objectContaining({
        requestId: admin.requestId,
        result: 'failed',
        errorCode: 'INTERNAL_ERROR',
      }),
    ]);
  });

  it('records an internal failure after rollback without exposing diagnostics or free-text reasons', async () => {
    const database = databaseWithStudent();
    const { repository, idempotency } = createOrgContentDocumentPersistence(database);
    const service = new OrganizationService(repository, clock, identifiers(), idempotency);
    const actor = { ...admin, requestId: 'request_internal_failure' };
    const sensitive = '手机号13800138000 绑定码654321 token=secret-token openid=o-secret password=p-secret';
    database.failNext({
      operation: 'find',
      collection: ORG_CONTENT_COLLECTIONS.classes,
      kind: 'internal',
      diagnosticMessage: 'stack secret-database-diagnostic',
    });

    await expect(service.createClass(actor, {
      name: '内部失败班级', grade: '五年级', term: '上学期', reason: sensitive,
      expectedVersion: 1, operationId: 'operation_internal_failure',
    })).rejects.toMatchObject({ kind: 'internal' });

    const snapshot = database.snapshot();
    expect(snapshot[ORG_CONTENT_COLLECTIONS.classes]?.some((item) => item.name === '内部失败班级')).toBe(false);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.idempotency] ?? []).toHaveLength(0);
    expect(snapshot[ORG_CONTENT_COLLECTIONS.organizationAudits]).toEqual([
      expect.objectContaining({
        _id: `audit:${ORGANIZATION_ID}:${actor.requestId}`,
        requestId: actor.requestId,
        actorRole: 'admin',
        action: 'class.created',
        targetType: 'class',
        targetId: 'new',
        result: 'failed',
        errorCode: 'INTERNAL_ERROR',
        metadata: { reasonProvided: true, reasonLength: sensitive.length },
      }),
    ]);
    const serializedLogs = JSON.stringify(snapshot[ORG_CONTENT_COLLECTIONS.organizationAudits]);
    for (const forbidden of ['13800138000', '654321', 'secret-token', 'o-secret', 'p-secret', 'secret-database-diagnostic']) {
      expect(serializedLogs).not.toContain(forbidden);
    }
  });

  it('allows only one concurrent CAS update and commits the denied outcome atomically', async () => {
    const database = databaseWithStudent();
    const { repository, idempotency } = createOrgContentDocumentPersistence(database);
    const service = new OrganizationService(repository, clock, identifiers(), idempotency);

    const results = await Promise.allSettled([
      service.updateClass(admin, {
        classId: CLASS_ID, name: '并发班级 A', grade: '三年级', term: '下学期', reason: '并发 A',
        expectedVersion: 1, operationId: 'operation_update_a',
      }),
      service.updateClass(admin, {
        classId: CLASS_ID, name: '并发班级 B', grade: '三年级', term: '下学期', reason: '并发 B',
        expectedVersion: 1, operationId: 'operation_update_b',
      }),
    ]);

    expect(results.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(repository.findClass(ORGANIZATION_ID, CLASS_ID)).resolves.toMatchObject({ version: 2 });
    expect(database.snapshot()[ORG_CONTENT_COLLECTIONS.idempotency]).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'failed', errorCode: 'CONFLICT' }),
    ]));
  });

  it('replays a derived binding code without persisting the six-digit plaintext', async () => {
    const database = databaseWithStudent();
    const { repository, idempotency } = createOrgContentDocumentPersistence(database);
    const codes = {
      nextSixDigits: () => '111111',
      deriveSixDigits: (seed: string) => String(100000 + seed.length).slice(-6),
    };
    const service = new RelationshipService(
      repository,
      clock,
      identifiers(),
      codes,
      { digest: (value) => `sha256_length_${value.length}` },
      idempotency,
    );

    const first = await service.issueBindingCode(admin, STUDENT_ID, 'operation_issue_code');
    const replay = await service.issueBindingCode(admin, STUDENT_ID, 'operation_issue_code');
    expect(replay).toEqual(first);
    const serialized = JSON.stringify(database.snapshot());
    expect(serialized).not.toContain(first.code);
    expect(database.snapshot()[ORG_CONTENT_COLLECTIONS.bindingCodes]).toEqual([
      expect.objectContaining({ status: 'active', attemptCount: 0 }),
    ]);
    const operationLogs = database.snapshot()[ORG_CONTENT_COLLECTIONS.relationshipAudits];
    expect(operationLogs).toEqual([
      expect.objectContaining({
        _id: `audit:${ORGANIZATION_ID}:${admin.requestId}`,
        requestId: admin.requestId,
        actorUserId: admin.actorUserId,
        actorRole: 'admin',
        action: 'binding_code.issued',
        targetType: 'binding_code',
        targetId: STUDENT_ID,
        result: 'succeeded',
        errorCode: null,
        metadata: { studentId: STUDENT_ID },
      }),
    ]);
    expect(operationLogs?.[0]).not.toHaveProperty('auditType');
    expect(operationLogs?.[0]).not.toHaveProperty('reason');
    expect(operationLogs?.[0]).not.toHaveProperty('studentId');
    expect(operationLogs?.[0]).not.toHaveProperty('parentId');
  });

  it('uses deterministic guards across repository instances for class names, student numbers and active codes', async () => {
    const database = databaseWithStudent();
    const first = createOrgContentDocumentRepository(database);
    const second = createOrgContentDocumentRepository(database);

    const classResults = await Promise.allSettled([
      first.transaction(async (transaction) => transaction.saveClass({
        id: 'class_guard_a', organizationId: ORGANIZATION_ID, name: '同名演示班', grade: '三年级',
        term: '上学期', status: 'active', version: 1,
      })),
      second.transaction(async (transaction) => transaction.saveClass({
        id: 'class_guard_b', organizationId: ORGANIZATION_ID, name: '同名演示班', grade: '四年级',
        term: '上学期', status: 'active', version: 1,
      })),
    ]);
    expect(classResults.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);

    const userResults = await Promise.allSettled([
      first.transaction(async (transaction) => transaction.saveUser({
        id: 'student_number_a', organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '虚构甲', displayNameMasked: '虚*',
        studentNumber: 'DEMO-GUARD', roles: ['student'], status: 'active', version: 1,
      })),
      second.transaction(async (transaction) => transaction.saveUser({
        id: 'student_number_b', organizationId: ORGANIZATION_ID, authorizationVersion: 1, displayName: '虚构乙', displayNameMasked: '虚*',
        studentNumber: 'DEMO-GUARD', roles: ['student'], status: 'active', version: 1,
      })),
    ]);
    expect(userResults.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);

    const codeResults = await Promise.allSettled([
      first.transaction(async (transaction) => transaction.saveBindingCode(bindingCode('code_guard_a'))),
      second.transaction(async (transaction) => transaction.saveBindingCode(bindingCode('code_guard_b'))),
    ]);
    expect(codeResults.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(database.snapshot()[ORG_CONTENT_COLLECTIONS.bindingCodes]?.filter((item) => item.status === 'active'))
      .toHaveLength(1);
  });

  it('keeps exactly one active code when two command instances issue concurrently', async () => {
    const database = databaseWithStudent();
    const firstPersistence = createOrgContentDocumentPersistence(database);
    const secondPersistence = createOrgContentDocumentPersistence(database);
    const codes = {
      nextSixDigits: () => '111111',
      deriveSixDigits: (seed: string) => String(100000 + seed.length).slice(-6),
    };
    const first = new RelationshipService(
      firstPersistence.repository, clock, prefixedIdentifiers('first'), codes,
      { digest: (value) => `digest_length_${value.length}` }, firstPersistence.idempotency,
    );
    const second = new RelationshipService(
      secondPersistence.repository, clock, prefixedIdentifiers('second'), codes,
      { digest: (value) => `digest_length_${value.length}` }, secondPersistence.idempotency,
    );

    await expect(Promise.all([
      first.issueBindingCode({ ...admin, requestId: 'request_issue_first' }, STUDENT_ID, 'operation_issue_first'),
      second.issueBindingCode({ ...admin, requestId: 'request_issue_second' }, STUDENT_ID, 'operation_issue_second'),
    ])).resolves.toHaveLength(2);
    expect(database.snapshot()[ORG_CONTENT_COLLECTIONS.bindingCodes]?.filter((item) => item.status === 'active'))
      .toHaveLength(1);
  });

  it('enforces pair and both relationship count guards, then releases counts on unbind', async () => {
    const parentId = 'parent_limit';
    const existing = Array.from({ length: 4 }, (_, index) => parentLinkDocument(
      `link_existing_${index}`,
      parentId,
      `student_existing_${index}`,
    ));
    const database = new FakeDocumentDatabase({ [ORG_CONTENT_COLLECTIONS.parentLinks]: existing });
    const first = createOrgContentDocumentRepository(database);
    const second = createOrgContentDocumentRepository(database);

    const parentLimitResults = await Promise.allSettled([
      first.transaction(async (transaction) => transaction.saveParentLink(parentLink('link_fifth', parentId, 'student_fifth'))),
      second.transaction(async (transaction) => transaction.saveParentLink(parentLink('link_sixth', parentId, 'student_sixth'))),
    ]);
    expect(parentLimitResults.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    const created = database.snapshot()[ORG_CONTENT_COLLECTIONS.parentLinks]
      ?.find((item) => item._id === 'link_fifth' || item._id === 'link_sixth');
    if (created === undefined) throw new Error('one guarded link expected');
    await first.transaction(async (transaction) => transaction.saveParentLink({
      ...parentLink(created._id, parentId, String(created.studentId)),
      status: 'revoked', revokedAt: NOW, revokedBy: parentId, revokeReason: '释放计数', version: 2,
    }));
    await expect(second.transaction(async (transaction) => transaction.saveParentLink(
      parentLink('link_after_release', parentId, 'student_after_release'),
    ))).resolves.toBeUndefined();

    const pairDatabase = new FakeDocumentDatabase();
    const pairFirst = createOrgContentDocumentRepository(pairDatabase);
    const pairSecond = createOrgContentDocumentRepository(pairDatabase);
    const pairResults = await Promise.allSettled([
      pairFirst.transaction(async (transaction) => transaction.saveParentLink(parentLink('pair_a', 'parent_pair', 'student_pair'))),
      pairSecond.transaction(async (transaction) => transaction.saveParentLink(parentLink('pair_b', 'parent_pair', 'student_pair'))),
    ]);
    expect(pairResults.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);

    const studentDatabase = new FakeDocumentDatabase({
      [ORG_CONTENT_COLLECTIONS.parentLinks]: [
        parentLinkDocument('student_existing_a', 'parent_existing_a', 'student_limit'),
        parentLinkDocument('student_existing_b', 'parent_existing_b', 'student_limit'),
      ],
    });
    const studentFirst = createOrgContentDocumentRepository(studentDatabase);
    const studentSecond = createOrgContentDocumentRepository(studentDatabase);
    const studentResults = await Promise.allSettled([
      studentFirst.transaction(async (transaction) => transaction.saveParentLink(parentLink('student_third', 'parent_third', 'student_limit'))),
      studentSecond.transaction(async (transaction) => transaction.saveParentLink(parentLink('student_fourth', 'parent_fourth', 'student_limit'))),
    ]);
    expect(studentResults.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});

const clock = { nowIso: () => NOW };

function identifiers() {
  let sequence = 0;
  return { next: (prefix: string) => `${prefix}_${++sequence}` };
}

function prefixedIdentifiers(instance: string) {
  let sequence = 0;
  return { next: (prefix: string) => `${prefix}_${instance}_${++sequence}` };
}

function databaseWithStudent(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [ORG_CONTENT_COLLECTIONS.classes]: [document(CLASS_ID, {
      name: '虚构三年级 2 班', grade: 3, term: '上学期', status: 'active',
    })],
    [ORG_CONTENT_COLLECTIONS.users]: [document(STUDENT_ID, {
      authorizationVersion: 1, displayName: '虚构学生', displayNameMasked: '虚构学*', studentNumber: 'DEMO-001', status: 'active',
    })],
    [ORG_CONTENT_COLLECTIONS.roles]: [document('role_student', {
      userId: STUDENT_ID, role: 'student', status: 'active', permissions: ['content.read'],
      scopeType: 'self', scopeIds: [STUDENT_ID], grantedBy: 'admin_demo', grantedAt: NOW,
    })],
    [ORG_CONTENT_COLLECTIONS.memberships]: [document('membership_demo', {
      classId: CLASS_ID, studentId: STUDENT_ID, status: 'active',
    })],
  });
}

function document(id: string, fields: Readonly<Record<string, VersionedDocument[string]>>): VersionedDocument {
  return { _id: id, organizationId: ORGANIZATION_ID, schemaVersion: 1, version: 1, deletedAt: null, ...fields };
}

function bindingCode(id: string) {
  return {
    id, organizationId: ORGANIZATION_ID, studentId: STUDENT_ID, codeDigest: `digest_${id}`,
    status: 'active' as const, attemptCount: 0, expiresAt: '2026-09-17T08:00:00.000+08:00',
    createdBy: 'admin_demo', createdAt: NOW, version: 1,
  };
}

function parentLink(id: string, parentId: string, studentId: string) {
  return {
    id, organizationId: ORGANIZATION_ID, parentId, studentId, status: 'active' as const,
    confirmedBy: 'admin_demo', confirmedAt: NOW, confirmationSource: 'binding_code' as const, version: 1,
  };
}

function parentLinkDocument(id: string, parentId: string, studentId: string): VersionedDocument {
  return document(id, {
    parentId, studentId, status: 'active', confirmedBy: 'admin_demo', confirmedAt: NOW,
    confirmationSource: 'binding_code',
  });
}
