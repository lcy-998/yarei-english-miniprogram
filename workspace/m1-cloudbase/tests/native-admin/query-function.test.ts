import { describe, expect, it } from 'vitest';
import { createNativeAdminQueryFunction, main as unconfigured } from '../../functions/native-admin-query';
import { validateNativeAdminQueryRequest } from '../../functions/native-admin-query/function-entry';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { DocumentNativeAdminGrantRepository, NATIVE_ADMIN_COLLECTIONS,
  nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import { NativeAdminQueryService } from '../../src/native-admin/query-service';

const actor: TrustedActorContext = { requestId: 'req_teacher', sessionId: 'ses_teacher',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_teacher', permissions: ['task.read'],
  scopeIds: ['class_demo'], authzVersion: 2 };

describe('native management mini-program entry', () => {
  it('accepts only a bounded, explicit management directory request', () => {
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listRecords',
      payload: { kind: 'media', page: { limit: 20, offset: 0 } } })).toMatchObject({
      ok: true, value: { action: 'listRecords', kind: 'media', limit: 20 } });
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listRecords',
      payload: { kind: 'media', page: { limit: 51, offset: 0 } } }).ok).toBe(false);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listRecords',
      payload: { kind: 'media', page: { limit: 20, offset: 0 }, actorRole: 'admin' } }).ok).toBe(false);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'getOverview',
      payload: { from: '2026-10-01', to: '2026-10-06' } }).ok).toBe(true);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'getQuestionPreview',
      payload: { questionId: 'question_demo' } }).ok).toBe(true);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listUserBindings',
      payload: { userId: 'user_demo' } }).ok).toBe(true);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listSelectionOptions',
      payload: { kind: 'teacher_for_class', classId: 'class_demo', query: '',
        page: { limit: 20, offset: 0 } } }).ok).toBe(true);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listSelectionOptions',
      payload: { kind: 'teacher_for_class', classId: '',
        page: { limit: 20, offset: 0 } } }).ok).toBe(false);
    expect(validateNativeAdminQueryRequest({ apiVersion: 'm1.v1', action: 'listSelectionOptions',
      payload: { kind: 'parent_for_binding', classId: '', organizationId: 'other',
        page: { limit: 20, offset: 0 } } }).ok).toBe(false);
  });
  it('returns only an independently granted current scope, rejecting forged fields and old sessions', async () => {
    const database = new FakeDocumentDatabase({
      [NATIVE_ADMIN_COLLECTIONS.users]: [{ _id: actor.actorUserId, organizationId: actor.organizationId,
        schemaVersion: 1, version: 2, deletedAt: null, status: 'active', authorizationVersion: 2 }],
      [NATIVE_ADMIN_COLLECTIONS.grants]: [{ _id: nativeAdminGrantId(actor.organizationId, actor.actorUserId),
        organizationId: actor.organizationId, schemaVersion: 1, version: 1, deletedAt: null,
        teacherId: actor.actorUserId, status: 'active', permissions: ['dashboard.read', 'user.manage'],
        scope: { organizationWide: false, classIds: ['class_demo'] } }],
    });
    const service = new NativeAdminQueryService(new DocumentNativeAdminGrantRepository(database));
    let currentActor = actor;
    const main = createNativeAdminQueryFunction({
      runtime: { functionName: 'native-admin-query',
        getPlatformSubject: async () => ({ subject: 'platform_demo', loginType: 'USERNAME', isAuthenticated: true }),
        getBusinessSessionId: async () => 'ses_teacher' },
      actorResolver: { resolve: async () => currentActor },
      clock: { nowIso: () => '2026-10-02T08:00:00+08:00' },
      requestIds: { next: () => 'req_result' }, service,
    });
    expect(await main({ apiVersion: 'm1.v1', action: 'getAccess', payload: {} }))
      .toMatchObject({ ok: true, data: { grantVersion: 1,
        permissions: ['dashboard.read', 'user.manage'], scope: { classIds: ['class_demo'] } } });
    expect(await main({ apiVersion: 'm1.v1', action: 'getAccess', payload: { actorRole: 'admin' } }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    currentActor = { ...actor, authzVersion: 1 };
    expect(await main({ apiVersion: 'm1.v1', action: 'getAccess', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('unconfigured entry fails closed', async () => {
    expect(await unconfigured({ apiVersion: 'm1.v1', action: 'getAccess', payload: {} }))
      .toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  });
});
