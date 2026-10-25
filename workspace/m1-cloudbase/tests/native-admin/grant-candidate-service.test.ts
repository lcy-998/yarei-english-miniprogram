import { describe, expect, it } from 'vitest';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentNativeAdminGrantRepository, nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminGrantCandidateService } from '../../src/native-admin/grant-candidate-service';
import { validateNativeAdminQueryRequest } from '../../functions/native-admin-query/function-entry';

const actor: TrustedActorContext = { requestId: 'req_manager', sessionId: 'ses_manager',
  actorUserId: 'teacher_manager', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_manager', permissions: [], scopeIds: [], authzVersion: 2 };
const base = { organizationId: 'org_demo', schemaVersion: 1 as const, version: 1, deletedAt: null };

function fixture() {
  const database = new FakeDocumentDatabase({
    users: [
      { _id: 'teacher_manager', ...base, authorizationVersion: 2, status: 'active' },
      { _id: 'teacher_first', ...base, authorizationVersion: 4, status: 'active',
        displayNameMasked: '虚构教师甲' },
      { _id: 'teacher_second', ...base, authorizationVersion: 3, status: 'active',
        displayNameMasked: '虚构教师乙' },
      { _id: 'teacher_outside', ...base, authorizationVersion: 1, status: 'active' },
      { _id: 'teacher_disabled', ...base, authorizationVersion: 1, status: 'disabled' },
      { _id: 'student_one', ...base, authorizationVersion: 1, status: 'active' },
      { _id: 'teacher_other_org', ...base, organizationId: 'org_other', authorizationVersion: 1,
        status: 'active' },
    ],
    role_assignments: ['teacher_manager', 'teacher_first', 'teacher_second',
      'teacher_outside', 'teacher_disabled', 'teacher_other_org'].map((userId, index) =>
      ({ _id: `role_${index}`, ...base, organizationId: userId === 'teacher_other_org' ? 'org_other' : 'org_demo',
        userId, role: 'teacher', status: 'active' })),
    teacher_class_grants: [
      { _id: 'class_grant_first', ...base, teacherId: 'teacher_first', classId: 'class_one', status: 'active' },
      { _id: 'class_grant_second', ...base, teacherId: 'teacher_second', classId: 'class_one', status: 'active' },
      { _id: 'class_grant_outside', ...base, teacherId: 'teacher_outside', classId: 'class_two', status: 'active' },
    ],
    native_admin_grants: [
      { _id: nativeAdminGrantId('org_demo', 'teacher_manager'), ...base,
        teacherId: 'teacher_manager', status: 'active', permissions: ['authorization.manage'],
        scope: { organizationWide: false, classIds: ['class_one'] } },
      { _id: nativeAdminGrantId('org_demo', 'teacher_second'), ...base, version: 3,
        teacherId: 'teacher_second', status: 'revoked', permissions: [],
        scope: { organizationWide: false, classIds: [] } },
    ],
  });
  const grants = new DocumentNativeAdminGrantRepository(database);
  return new NativeAdminGrantCandidateService(grants, database);
}

describe('native management grant candidates', () => {
  it('lists only current-scope active teachers with versions for first grant and regrant', async () => {
    const service = fixture();
    expect(await service.list(actor, 1, 0)).toMatchObject({ items: [{
      teacherId: 'teacher_first', userVersion: 1, authorizationVersion: 4,
      grantVersion: 0, grantStatus: 'none' }], nextOffset: 1 });
    expect(await service.list(actor, 1, 1)).toMatchObject({ items: [{
      teacherId: 'teacher_second', authorizationVersion: 3,
      grantVersion: 3, grantStatus: 'revoked' }], nextOffset: null });
    expect(await service.list(actor, 20, 0, '虚构教师乙')).toMatchObject({
      items: [{ teacherId: 'teacher_second' }], nextOffset: null });
    expect(JSON.stringify(await service.list(actor, 20, 0))).not.toContain('teacher_outside');
  });

  it('rejects an old management session and invalid paging', async () => {
    const service = fixture();
    await expect(service.list({ ...actor, authzVersion: 1 }, 20, 0))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.list(actor, 51, 0)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('validates the dedicated read request without client supplied authority', () => {
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listGrantCandidates',
      payload: { query: '虚构', page: { limit: 20, offset: 0 } } })).toMatchObject({
      ok: true, value: { action: 'listGrantCandidates', query: '虚构', limit: 20, offset: 0 } });
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listGrantCandidates',
      payload: { page: { limit: 20, offset: 0 }, organizationId: 'org_other' } }).ok).toBe(false);
  });
});
