import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cloudbaseUsernameSubject, type TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import type { DocumentDatabaseTransactionPort } from '../../src/repositories/document-database-port';
import { NativeAdminAccountService, type NativeAccountProvider, type NativeAccountInput } from '../../src/native-admin/account-service';
import { NativeAdminManagementService } from '../../src/native-admin/management-service';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { validateNativeAdminManagementRequest } from '../../functions/native-admin-management-command/function-entry';

const actor: TrustedActorContext = { requestId: 'request_manager', sessionId: 'session_manager', actorUserId: 'teacher_manager',
  actorRole: 'teacher', organizationId: 'org_demo', platformSubjectDigest: 'sd1_manager', permissions: [], scopeIds: [], authzVersion: 2 };
const digest = { digest(value: string) { return `sd1_${createHmac('sha256', 'synthetic-test-key').update(value).digest('hex')}`; } };
const input: NativeAccountInput = { displayName: '虚构新学员', mobile: '13800000001', role: 'student', classId: 'class_one', reason: '创建虚构测试账号' };

function fixture(options: { configured?: boolean; duplicate?: boolean; lookupFails?: boolean;
  organizationWide?: boolean; afterProvision?: (db: FakeDocumentDatabase) => Promise<void> } = {}) {
  const base = { organizationId: 'org_demo', schemaVersion: 1 as const, version: 1, deletedAt: null };
  const database = new FakeDocumentDatabase({
    users: [{ ...base, _id: actor.actorUserId, status: 'active', authorizationVersion: 2 }],
    classes: [{ ...base, _id: 'class_one', name: '三年级 2 班', status: 'active' },
      { ...base, _id: 'class_other_school', organizationId: 'org_other', status: 'active' }],
    native_admin_grants: [{ ...base, _id: nativeAdminGrantId('org_demo', actor.actorUserId), teacherId: actor.actorUserId,
      status: 'active', permissions: ['user.manage', 'authorization.manage', 'organization.manage'],
      scope: { organizationWide: options.organizationWide ?? true, classIds: ['class_one'] } }],
  });
  const provisioned: string[] = []; const blocked: string[] = [];
  const provider: NativeAccountProvider = {
    async mobileExists() {
      if (options.lookupFails) throw new Error('simulated manager permission failure');
      return options.duplicate === true;
    },
    async provision(_input, key) {
      provisioned.push(key);
      await options.afterProvision?.(database);
      return { platformUid: `uid_${key}`, subjectDigest: digest.digest(cloudbaseUsernameSubject(`uid_${key}`)) };
    },
    async blockUnlinked(receipt) { blocked.push(receipt.platformUid); },
  };
  const grants = new DocumentNativeAdminGrantRepository(database);
  const clock = { nowIso: () => '2026-10-06T12:00:00+08:00' };
  return { database, provider, provisioned, blocked,
    service: new NativeAdminAccountService(database, grants, digest, clock, options.configured === false ? undefined : provider),
    management: new NativeAdminManagementService(database, grants, clock) };
}

describe('A-03 controlled identity provisioning', () => {
  it('fails before any business write when no trusted identity provider is installed', async () => {
    const { service, database } = fixture({ configured: false });
    await expect(service.createUser(actor, input, 0, 'operation_create_missing')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(database.snapshot().users).toHaveLength(1);
    expect(database.snapshot().native_admin_account_operations ?? []).toHaveLength(0);
    expect(database.snapshot().auth_identities ?? []).toHaveLength(0);
  });

  it('atomically creates login mapping, role, membership and audit after provider identity confirmation, with self-service password setup required', async () => {
    const { service, database, provisioned } = fixture();
    const result = await service.createUser(actor, input, 0, 'operation_create_student');
    expect(result).toMatchObject({ role: 'student', setupStatus: 'self_service_required', status: 'active' });
    expect(await service.createUser(actor, input, 0, 'operation_create_student')).toEqual(result);
    expect(provisioned).toHaveLength(1);
    const snapshot = database.snapshot();
    expect(snapshot.auth_identities?.[0]).toMatchObject({ userId: result.id, provider: 'cloudbase_uid', status: 'active' });
    expect(snapshot.role_assignments?.[0]).toMatchObject({ userId: result.id, role: 'student', scopeIds: [result.id] });
    expect(snapshot.class_memberships?.[0]).toMatchObject({ studentId: result.id, classId: 'class_one' });
    expect(snapshot.operation_logs).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain(input.mobile);
    expect(JSON.stringify(snapshot)).not.toContain('password');
    await expect(service.createUser(actor, { ...input, mobile: '13800000002' }, 0, 'operation_create_student')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects provider duplicates and global operation reservations without half accounts', async () => {
    const duplicated = fixture({ duplicate: true });
    await expect(duplicated.service.createUser(actor, input, 0, 'operation_duplicate_phone')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(duplicated.provisioned).toHaveLength(0);
    const normal = fixture();
    await normal.service.createUser(actor, input, 0, 'operation_phone_first');
    await expect(normal.service.createUser(actor, input, 0, 'operation_phone_second')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(normal.provisioned).toHaveLength(1);
  });

  it('does not reserve a phone when the trusted identity lookup is unavailable', async () => {
    const { service, database, provisioned } = fixture({ lookupFails: true });
    await expect(service.createUser(actor, input, 0, 'operation_manager_lookup_failure'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(database.snapshot().users).toHaveLength(1);
    expect(database.snapshot().native_admin_account_operations ?? []).toHaveLength(0);
    expect(database.snapshot().auth_identities ?? []).toHaveLength(0);
    expect(provisioned).toHaveLength(0);
  });

  it('reserves the same mobile across concurrent operations before contacting the provider', async () => {
    const { service, provisioned } = fixture();
    const attempts = await Promise.allSettled([
      service.createUser(actor, input, 0, 'operation_concurrent_first'),
      service.createUser(actor, input, 0, 'operation_concurrent_second'),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(provisioned).toHaveLength(1);
  });

  it('reconciles a lost successful business receipt without blocking the linked identity', async () => {
    const { service, database, blocked } = fixture();
    const transaction = database.runTransaction.bind(database);
    let lostResponse = false;
    database.runTransaction = async <T>(work: (tx: DocumentDatabaseTransactionPort) => Promise<T>): Promise<T> => {
      const result = await transaction(work);
      if (!lostResponse && result && typeof result === 'object' && 'setupStatus' in result) {
        lostResponse = true;
        throw new Error('simulated response lost after committed transaction');
      }
      return result;
    };
    expect(await service.createUser(actor, input, 0, 'operation_lost_business_receipt')).toMatchObject({ setupStatus: 'self_service_required' });
    expect(blocked).toHaveLength(0);
    expect(database.snapshot().users).toHaveLength(2);
  });

  it('keeps an uncertain provider operation retryable without creating a business-only account', async () => {
    const { service, provider, database } = fixture();
    const provision = provider.provision.bind(provider);
    let first = true;
    provider.provision = async (value, key) => {
      if (first) { first = false; throw new Error('provider identity confirmation lost'); }
      return provision(value, key);
    };
    await expect(service.createUser(actor, input, 0, 'operation_setup_retry')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(database.snapshot().users).toHaveLength(1);
    expect(await service.createUser(actor, input, 0, 'operation_setup_retry')).toMatchObject({ setupStatus: 'self_service_required' });
  });

  it('rejects cross-school class creation and a class manager creating nonstudents', async () => {
    const { service, provisioned } = fixture({ organizationWide: false });
    await expect(service.createUser(actor, { ...input, classId: 'class_other_school' }, 0, 'operation_other_school')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.createUser(actor, { ...input, role: 'parent', classId: '' }, 0, 'operation_parent_forbidden')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(provisioned).toHaveLength(0);
  });

  it('claims compensation before blocking an unlinked account after in-flight revocation', async () => {
    const { service, database, blocked } = fixture({ afterProvision: async db => {
      await db.runTransaction(async tx => {
        const user = await tx.get('users', actor.actorUserId);
        if (!user) throw new Error('missing fixture');
        await tx.replace('users', user._id, user.version, { ...user, version: user.version + 1, authorizationVersion: 3 });
      });
    } });
    await expect(service.createUser(actor, input, 0, 'operation_revoke_during_create')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(blocked).toHaveLength(1);
    expect(database.snapshot().users).toHaveLength(1);
    expect(database.snapshot().auth_identities ?? []).toHaveLength(0);
    expect(database.snapshot().native_admin_account_operations?.some(row => row.state === 'compensated')).toBe(true);
  });

  it('creates teachers without class or management rights and activates teaching rights only when assigned', async () => {
    const { service, database, management, provisioned } = fixture();
    const teacher = await service.createUser(actor, { ...input, role: 'teacher', classId: '' }, 0, 'operation_create_teacher');
    expect(database.snapshot().auth_identities?.[0]?.providerSubjectDigest)
      .toBe(digest.digest(cloudbaseUsernameSubject(`uid_${provisioned[0]}`)));
    expect(database.snapshot().role_assignments?.[0]).toMatchObject({ role: 'teacher', scopeIds: [], permissions: ['class.read'] });
    expect(database.snapshot().native_admin_grants).toHaveLength(1);
    await management.assignTeacher(actor, { classId: 'class_one', teacherId: teacher.id,
      permissions: ['class.read', 'task.publish'], reason: '安排虚构教师' }, 0, 'operation_assign_new_teacher');
    expect(database.snapshot().role_assignments?.[0]).toMatchObject({ scopeIds: ['class_one'], permissions: ['class.read', 'task.publish'] });
    expect(database.snapshot().users?.find(row => row._id === teacher.id)).toMatchObject({ authorizationVersion: 2 });
  });

  it.each(['parent', 'admin'] as const)('creates a %s identity without manufacturing school management rights', async role => {
    const { service, database } = fixture();
    const created = await service.createUser(actor, { ...input, role, classId: '' }, 0, `operation_create_${role}`);
    expect(created).toMatchObject({ role, setupStatus: 'self_service_required' });
    expect(database.snapshot().class_memberships ?? []).toHaveLength(0);
    expect(database.snapshot().native_admin_grants).toHaveLength(1);
    if (role === 'admin') expect(database.snapshot().role_assignments?.[0]?.permissions).toEqual([]);
  });

  it('requires explicit authorization management to create an employee identity', async () => {
    const { service, database, provisioned } = fixture();
    await database.runTransaction(async tx => {
      const grant = await tx.get('native_admin_grants', nativeAdminGrantId('org_demo', actor.actorUserId));
      if (!grant) throw new Error('missing fixture');
      await tx.replace('native_admin_grants', grant._id, grant.version, { ...grant,
        permissions: ['user.manage'], version: grant.version + 1 });
    });
    await expect(service.createUser(actor, { ...input, role: 'admin', classId: '' }, 0, 'operation_employee_denied'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(provisioned).toHaveLength(0);
  });

  it('rejects the legacy administrator reset action without contacting a provider or writing data', async () => {
    const { service, database, provider } = fixture();
    const result = await service.createUser(actor, input, 0, 'operation_reset_target');
    let resetCalls = 0;
    Object.assign(provider, { async requestPasswordReset() { resetCalls += 1; return { status: 'sent' }; } });
    const before = database.snapshot();
    await expect(service.requestPasswordReset(actor, { userId: result.id, reason: '旧客户端尝试' },
      1, 'operation_legacy_reset')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(resetCalls).toBe(0);
    expect(database.snapshot()).toEqual(before);
    await expect(fixture({ configured: false }).service.requestPasswordReset(actor,
      { userId: result.id, reason: '旧客户端尝试' }, 1, 'operation_unconfigured_reset'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('strictly rejects supplied passwords, actor and organization claims', () => {
    for (const injected of [{ password: 'do-not-store' }, { organizationId: 'org_other' }, { actorUserId: 'other' }]) {
      expect(validateNativeAdminManagementRequest({ apiVersion: 'm1.v1', action: 'createUser', payload: { ...input, ...injected },
        expectedVersion: 0, operationId: 'operation_invalid_account' }).ok).toBe(false);
    }
  });
});

