import { describe, expect, it } from 'vitest';
import { RepositoryTrustedActorResolver } from '../../src/auth/actor-resolver';
import type { PlatformIdentity } from '../../src/auth/trusted-actor';
import type { BusinessSessionRecord } from '../../src/runtime/records';
import type { JsonValue } from '../../src/shared/protocol';
import type { VersionedDocument } from '../../src/repositories/document-database-port';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import {
  IDENTITY_SESSION_COLLECTIONS,
  createBusinessSessionDocumentRepository,
  createIdentityDocumentRepository,
} from '../../src/repositories/identity-session-document-adapter';

const ORGANIZATION_ID = 'org_demo';
const USER_ID = 'student_demo';
const SUBJECT = 'cloudbase:username:uid_demo';
const SUBJECT_DIGEST = `digest:${SUBJECT}`;
const NOW = '2026-09-16T12:00:00.000+08:00';
const EXPIRES_AT = '2026-09-17T12:00:00.000+08:00';

describe('identity document repository', () => {
  it('reads only active, tenant-scoped identity and authorization records', async () => {
    const database = identityDatabase();
    const repository = createIdentityDocumentRepository(database);

    await expect(repository.findIdentityByDigest(SUBJECT_DIGEST)).resolves.toMatchObject({
      _id: 'identity_demo',
      userId: USER_ID,
      provider: 'cloudbase_uid',
      status: 'active',
    });
    await expect(repository.findUser(USER_ID, ORGANIZATION_ID)).resolves.toMatchObject({
      _id: USER_ID,
      displayName: '小宇',
      status: 'active',
    });
    await expect(repository.findUser(USER_ID, 'org_other')).resolves.toBeNull();
    await expect(repository.findOrganization(ORGANIZATION_ID)).resolves.toMatchObject({
      _id: ORGANIZATION_ID,
      status: 'active',
      timeZone: 'Asia/Shanghai',
    });
    await expect(repository.listActiveRoles(USER_ID, ORGANIZATION_ID)).resolves.toEqual([
      expect.objectContaining({ _id: 'role_student', role: 'student', version: 2 }),
    ]);
    await expect(repository.findActiveTeacherGrant(ORGANIZATION_ID, 'teacher_demo', 'class_demo'))
      .resolves.toMatchObject({ _id: 'grant_demo', permissions: ['student.read'] });
    await expect(repository.listActiveParentLinks(ORGANIZATION_ID, 'parent_demo')).resolves.toEqual([
      expect.objectContaining({ _id: 'link_demo', studentId: USER_ID }),
    ]);
    await expect(repository.findActiveParentLink(ORGANIZATION_ID, 'parent_demo', USER_ID))
      .resolves.toMatchObject({ _id: 'link_demo' });
  });

  it('fails closed when a supposedly unique active identity digest is duplicated', async () => {
    const database = identityDatabase();
    await database.runTransaction(async (transaction) => {
      expect(await transaction.create(IDENTITY_SESSION_COLLECTIONS.identities, document(
        'identity_duplicate',
        ORGANIZATION_ID,
        1,
        {
          userId: 'other_user',
          provider: 'cloudbase_uid',
          providerSubjectDigest: SUBJECT_DIGEST,
          status: 'active',
        },
      ))).toBe(true);
    });

    await expect(createIdentityDocumentRepository(database).findIdentityByDigest(SUBJECT_DIGEST)).resolves.toBeNull();
  });
});

describe('business session document repository', () => {
  it('persists and resumes one active session across repository instances', async () => {
    const database = new FakeDocumentDatabase();
    const first = createBusinessSessionDocumentRepository(database);
    const started = await first.startOrResume(session('session_first'), NOW);
    const resumed = await createBusinessSessionDocumentRepository(database)
      .startOrResume(session('session_retry'), NOW);

    expect(resumed).toEqual(started);
    expect(await createBusinessSessionDocumentRepository(database).find('session_first')).toEqual(started);
    expect(await createBusinessSessionDocumentRepository(database).find('session_retry')).toBeNull();
    expect(database.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessions]).toHaveLength(1);
    expect(database.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessionSlots]).toHaveLength(1);
  });

  it('revokes the old session when authorization changes or the active session expires', async () => {
    const database = new FakeDocumentDatabase();
    const repository = createBusinessSessionDocumentRepository(database);
    await repository.startOrResume(session('session_v1', { authzVersion: 1 }), NOW);

    const changed = await repository.startOrResume(session('session_v2', { authzVersion: 2 }), NOW);
    expect(changed.id).toBe('session_v2');
    expect(await repository.find('session_v1')).toMatchObject({ revokedAt: NOW, recordVersion: 2 });

    const afterExpiry = '2026-09-18T12:00:00.000+08:00';
    const renewed = await repository.startOrResume(session('session_v2_renewed', {
      authzVersion: 2,
      expiresAt: '2026-09-19T12:00:00.000+08:00',
    }), afterExpiry);
    expect(renewed.id).toBe('session_v2_renewed');
    expect(await repository.find('session_v2')).toMatchObject({ revokedAt: afterExpiry, recordVersion: 2 });
  });

  it('keeps mini-program and admin-console slots isolated and persists a bounded refresh', async () => {
    const database = new FakeDocumentDatabase();
    const repository = createBusinessSessionDocumentRepository(database);
    const mini = await repository.startOrResume(session('session_mini'), NOW);
    const admin = await repository.startOrResume(session('session_admin', {
      audience: 'admin-console',
      role: 'admin',
    }), NOW);

    expect(mini.audience).toBeUndefined();
    expect(admin).toMatchObject({ audience: 'admin-console', role: 'admin', revokedAt: null });
    expect(await repository.find(mini.id)).toMatchObject({ role: 'student', revokedAt: null });
    expect(database.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessions]).toHaveLength(2);
    expect(database.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessionSlots]).toHaveLength(2);

    const refreshedExpiry = '2026-09-18T12:00:00.000+08:00';
    expect(await repository.replace({
      ...admin,
      expiresAt: refreshedExpiry,
      recordVersion: admin.recordVersion + 1,
    }, admin.recordVersion)).toBe(true);
    await expect(repository.find(admin.id)).resolves.toMatchObject({
      audience: 'admin-console',
      expiresAt: refreshedExpiry,
      recordVersion: 2,
    });
  });

  it('lets concurrent bootstrap attempts converge on one committed session', async () => {
    const database = new FakeDocumentDatabase();
    const repositoryA = createBusinessSessionDocumentRepository(database);
    const repositoryB = createBusinessSessionDocumentRepository(database);
    const [left, right] = await Promise.all([
      repositoryA.startOrResume(session('session_concurrent_a'), NOW),
      repositoryB.startOrResume(session('session_concurrent_b'), NOW),
    ]);

    expect(right).toEqual(left);
    const stored = database.snapshot()[IDENTITY_SESSION_COLLECTIONS.sessions] ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]?._id).toBe(left.id);
  });

  it('enforces compare-and-swap so only one concurrent session mutation wins', async () => {
    const database = new FakeDocumentDatabase();
    const repository = createBusinessSessionDocumentRepository(database);
    const initial = await repository.startOrResume(session('session_cas'), NOW);
    const [studentRole, parentRole] = await Promise.all([
      repository.replace({ ...initial, role: 'student', recordVersion: 2 }, 1),
      repository.replace({ ...initial, role: 'parent', recordVersion: 2 }, 1),
    ]);

    expect([studentRole, parentRole].filter(Boolean)).toHaveLength(1);
    const stored = await repository.find(initial.id);
    expect(stored).toMatchObject({ recordVersion: 2 });
    expect(stored?.role === 'student' || stored?.role === 'parent').toBe(true);
    await expect(repository.replace({ ...(stored as BusinessSessionRecord), revokedAt: NOW, recordVersion: 3 }, 1))
      .resolves.toBe(false);
  });

  it('supports actor rejection after revocation, expiry, or authorization-version change', async () => {
    const database = identityDatabase();
    const sessions = createBusinessSessionDocumentRepository(database);
    const identities = createIdentityDocumentRepository(database);
    const active = await sessions.startOrResume(session('session_actor'), NOW);
    const identity: PlatformIdentity = { subject: SUBJECT, loginType: 'USERNAME', isAuthenticated: true };
    const resolver = () => new RepositoryTrustedActorResolver(
      identities,
      sessions,
      { digest: (value) => `digest:${value}` },
      { nowIso: () => NOW },
      { next: () => 'request_actor' },
    );

    await expect(resolver().resolve(identity, 'task-query', active.id)).resolves.toMatchObject({
      actorUserId: USER_ID,
      actorRole: 'student',
      authzVersion: 2,
    });
    expect(await sessions.replace({ ...active, revokedAt: NOW, recordVersion: 2 }, 1)).toBe(true);
    await expect(resolver().resolve(identity, 'task-query', active.id)).resolves.toBeNull();

    const expired = await sessions.startOrResume(session('session_expired', {
      expiresAt: '2026-09-16T12:00:01.000+08:00',
    }), NOW);
    const afterExpiry = new RepositoryTrustedActorResolver(
      identities,
      sessions,
      { digest: (value) => `digest:${value}` },
      { nowIso: () => '2026-09-16T12:00:02.000+08:00' },
      { next: () => 'request_expired' },
    );
    await expect(afterExpiry.resolve(identity, 'task-query', expired.id)).resolves.toBeNull();

    await database.runTransaction(async (transaction) => {
      const role = await transaction.get(IDENTITY_SESSION_COLLECTIONS.roles, 'role_student');
      if (role === null) throw new Error('role fixture expected');
      expect(await transaction.replace(IDENTITY_SESSION_COLLECTIONS.roles, role._id, role.version, {
        ...role,
        version: role.version + 100,
      })).toBe(true);
    });
    const staleAuthorization = await sessions.startOrResume(session('session_stale_authz', {
      authzVersion: 2,
      expiresAt: EXPIRES_AT,
    }), NOW);
    await expect(resolver().resolve(identity, 'task-query', staleAuthorization.id)).resolves.toMatchObject({
      actorUserId: USER_ID,
      authzVersion: 2,
    });
    await database.runTransaction(async (transaction) => {
      const user = await transaction.get(IDENTITY_SESSION_COLLECTIONS.users, USER_ID);
      if (user === null) throw new Error('user fixture expected');
      expect(await transaction.replace(IDENTITY_SESSION_COLLECTIONS.users, user._id, user.version, {
        ...user,
        authorizationVersion: 3,
        version: user.version + 1,
      })).toBe(true);
    });
    await expect(resolver().resolve(identity, 'task-query', staleAuthorization.id)).resolves.toBeNull();
  });
});

function identityDatabase(): FakeDocumentDatabase {
  return new FakeDocumentDatabase({
    [IDENTITY_SESSION_COLLECTIONS.organizations]: [document(
      ORGANIZATION_ID,
      ORGANIZATION_ID,
      1,
      { name: '启航实验学校', status: 'active', timeZone: 'Asia/Shanghai' },
    )],
    [IDENTITY_SESSION_COLLECTIONS.users]: [document(
      USER_ID,
      ORGANIZATION_ID,
      1,
      {
        authorizationVersion: 2,
        displayName: '小宇',
        displayNameMasked: '小*',
        studentNumber: 'STU-DEMO-001',
        classId: 'class_demo',
        className: '三年级 2 班',
        status: 'active',
      },
    )],
    [IDENTITY_SESSION_COLLECTIONS.identities]: [document(
      'identity_demo',
      ORGANIZATION_ID,
      1,
      { userId: USER_ID, provider: 'cloudbase_uid', providerSubjectDigest: SUBJECT_DIGEST, status: 'active' },
    )],
    [IDENTITY_SESSION_COLLECTIONS.roles]: [
      document('role_student', ORGANIZATION_ID, 2, {
        userId: USER_ID,
        role: 'student',
        status: 'active',
        permissions: ['content.read'],
        scopeIds: [USER_ID],
      }),
      document('role_revoked', ORGANIZATION_ID, 5, {
        userId: USER_ID,
        role: 'parent',
        status: 'revoked',
        permissions: ['child.read'],
        scopeIds: [],
      }),
    ],
    [IDENTITY_SESSION_COLLECTIONS.teacherGrants]: [document('grant_demo', ORGANIZATION_ID, 1, {
      teacherId: 'teacher_demo',
      classId: 'class_demo',
      status: 'active',
      permissions: ['student.read'],
    })],
    [IDENTITY_SESSION_COLLECTIONS.parentLinks]: [document('link_demo', ORGANIZATION_ID, 1, {
      parentId: 'parent_demo',
      studentId: USER_ID,
      status: 'active',
      confirmedAt: NOW,
    })],
  });
}

function session(
  id: string,
  overrides: Partial<Pick<BusinessSessionRecord, 'authzVersion' | 'expiresAt' | 'audience' | 'role'>> = {},
): BusinessSessionRecord {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    subjectDigest: SUBJECT_DIGEST,
    ...(overrides.audience === undefined ? {} : { audience: overrides.audience }),
    role: overrides.role ?? 'student',
    authzVersion: overrides.authzVersion ?? 2,
    recordVersion: 1,
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
    revokedAt: null,
  };
}

function document(
  id: string,
  organizationId: string,
  version: number,
  data: Readonly<Record<string, JsonValue>>,
): VersionedDocument {
  return {
    ...data,
    _id: id,
    organizationId,
    schemaVersion: 1,
    version,
    deletedAt: null,
  };
}
