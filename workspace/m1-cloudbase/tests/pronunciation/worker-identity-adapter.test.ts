import { describe, expect, it } from 'vitest';
import { FreshPronunciationWorkerIdentity } from '../../src/pronunciation/worker-identity-adapter';
import type { IdentityRepository } from '../../src/runtime/ports';

const digest = `sd1_${'a'.repeat(43)}`;
function fixture() {
  let identityStatus: 'active' | 'revoked' = 'active';
  let userStatus: 'active' | 'disabled' = 'active';
  let organizationStatus: 'active' | 'disabled' = 'active';
  let studentRole = true;
  let authorizationVersion = 3;
  const identities = {
    async findIdentityByDigest(value: string) {
      return value === digest ? { organizationId: 'org_virtual_01', userId: 'student_virtual_01',
        status: identityStatus } : null;
    },
    async findUser() { return { status: userStatus, authorizationVersion }; },
    async findOrganization() { return { status: organizationStatus }; },
    async listActiveRoles() { return studentRole ? [{ role: 'student', status: 'active',
      permissions: ['learning.read'], scopeIds: ['class_virtual_01'] }] : []; },
  } as unknown as IdentityRepository;
  return { service: new FreshPronunciationWorkerIdentity(identities),
    revokeIdentity: () => { identityStatus = 'revoked'; },
    disableUser: () => { userStatus = 'disabled'; },
    disableOrganization: () => { organizationStatus = 'disabled'; },
    revokeRole: () => { studentRole = false; },
    incrementAuthz: () => { authorizationVersion += 1; } };
}

describe('M3 worker fresh identity', () => {
  it('re-issues only active student identity with the current authorization version', async () => {
    const state = fixture();
    const first = await state.service.currentStudent('org_virtual_01', 'student_virtual_01', digest);
    expect(first).toMatchObject({ actorRole: 'student', actorUserId: 'student_virtual_01',
      authzVersion: 3, scopeIds: ['class_virtual_01'] });
    state.incrementAuthz();
    expect((await state.service.currentStudent('org_virtual_01', 'student_virtual_01', digest))?.authzVersion)
      .toBe(4);
    expect(await state.service.currentStudent('org_virtual_01', 'student_virtual_01', `sd1_${'b'.repeat(43)}`))
      .toBeNull();
    expect(await state.service.currentStudent('org_virtual_01', 'student_virtual_01', 'a'.repeat(64)))
      .toBeNull();
  });

  it('fails closed after identity, user, organization or role revocation', async () => {
    for (const disable of ['revokeIdentity', 'disableUser', 'disableOrganization', 'revokeRole'] as const) {
      const state = fixture();
      state[disable]();
      expect(await state.service.currentStudent('org_virtual_01', 'student_virtual_01', digest))
        .toBeNull();
    }
  });
});
