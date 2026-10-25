import { describe, expect, it } from 'vitest';
import { FakeDocumentDatabase } from '../../src/repositories/fake-document-database';
import { authorizeNativeAdmin } from '../../src/native-admin/authorization';
import { DocumentNativeAdminGrantRepository, NATIVE_ADMIN_COLLECTIONS,
  nativeAdminGrantId } from '../../src/native-admin/document-grant-repository';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';

const actor: TrustedActorContext = { requestId: 'req_demo', sessionId: 'ses_demo',
  actorUserId: 'teacher_demo', actorRole: 'teacher', organizationId: 'org_demo',
  platformSubjectDigest: 'digest_demo', permissions: ['task.read'],
  scopeIds: ['class_demo'], authzVersion: 3 };

describe('native admin persistent read boundary', () => {
  it('requires an active per-account grant and current user authorization version', async () => {
    const database = new FakeDocumentDatabase({
      [NATIVE_ADMIN_COLLECTIONS.users]: [{ _id: actor.actorUserId, organizationId: actor.organizationId,
        schemaVersion: 1, version: 3, deletedAt: null, status: 'active', authorizationVersion: 3 }],
      [NATIVE_ADMIN_COLLECTIONS.grants]: [{ _id: nativeAdminGrantId(actor.organizationId, actor.actorUserId),
        organizationId: actor.organizationId, teacherId: actor.actorUserId,
        schemaVersion: 1, version: 2, deletedAt: null, status: 'active',
        permissions: ['dashboard.read', 'media.review'],
        scope: { organizationWide: false, classIds: ['class_demo'] } }],
    });
    const reader = new DocumentNativeAdminGrantRepository(database);
    expect(await authorizeNativeAdmin(reader, actor, 'media.review', 'class_demo'))
      .toMatchObject({ allowed: true, grantVersion: 2 });
    expect(await authorizeNativeAdmin(reader, actor, 'media.review', 'class_other'))
      .toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(await authorizeNativeAdmin(reader, { ...actor, authzVersion: 2 }, 'media.review', 'class_demo'))
      .toEqual({ allowed: false, reason: 'FORBIDDEN' });
  });
});
