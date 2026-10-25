import { describe, expect, it } from 'vitest';
import { authorizeNativeAdmin, type NativeAdminGrantReader } from '../../src/native-admin/authorization';
import type { TrustedActorContext } from '../../src/auth/trusted-actor';

const actor: TrustedActorContext = { requestId: 'req_demo', sessionId: 'ses_demo', actorUserId: 'teacher_demo',
  actorRole: 'teacher', organizationId: 'org_demo', platformSubjectDigest: 'digest_demo',
  permissions: ['task.read'], scopeIds: ['class_demo'], authzVersion: 4 };
let version = 4;
let revoked = false;
const reader: NativeAdminGrantReader = {
  async currentAuthorizationVersion() { return version; },
  async findGrant() { return { organizationId: 'org_demo', teacherId: 'teacher_demo',
    status: revoked ? 'revoked' : 'active', permissions: ['dashboard.read', 'user.manage'],
    scope: { organizationWide: false, classIds: ['class_demo'] }, version: 2 }; },
};

describe('native administrator boundary', () => {
  it('denies an ordinary teacher without an independent management grant', async () => {
    const ungrantedReader: NativeAdminGrantReader = {
      async currentAuthorizationVersion() { return 0; },
      async findGrant() { return null; },
    };
    expect(await authorizeNativeAdmin(ungrantedReader, actor, 'dashboard.read'))
      .toEqual({ allowed: false, reason: 'FORBIDDEN' });
  });

  it('requires independent per-account grant and current authorization version', async () => {
    version = 4; revoked = false;
    expect(await authorizeNativeAdmin(reader, actor, 'user.manage', 'class_demo')).toMatchObject({ allowed: true, grantVersion: 2 });
    expect(await authorizeNativeAdmin(reader, actor, 'media.review', 'class_demo')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(await authorizeNativeAdmin(reader, actor, 'user.manage', 'class_other')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    expect(await authorizeNativeAdmin(reader, { ...actor, actorRole: 'student' }, 'dashboard.read')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    version = 5;
    expect(await authorizeNativeAdmin(reader, actor, 'user.manage', 'class_demo')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
    version = 4; revoked = true;
    expect(await authorizeNativeAdmin(reader, actor, 'user.manage', 'class_demo')).toEqual({ allowed: false, reason: 'FORBIDDEN' });
  });
});
