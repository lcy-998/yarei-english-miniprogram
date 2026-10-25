import { describe, expect, it } from 'vitest';
import { CloudBaseNativeAccountProvider } from '../../src/native-admin/cloudbase-account-provider';
import type { CloudBaseManagerUserPort } from '../../src/teacher-students/cloudbase-manager-auth-port';

function fixture() {
  type User = { Uid: string; Name: string; Type: string; Phone: string; UserStatus: 'ACTIVE' | 'BLOCKED' };
  const users = new Map<string, User>();
  const creates: unknown[] = [];
  let loseResponse = false;
  const manager: CloudBaseManagerUserPort = {
    async describeUserList(options) {
      const list = [...users.values()].filter(user => options.uidList?.includes(user.Uid) || options.phone === user.Phone);
      return { Data: { Total: list.length, UserList: list } };
    },
    async createUser(options) {
      creates.push(options);
      users.set(options.uid, { Uid: options.uid, Name: options.name, Type: options.type, Phone: options.phone, UserStatus: options.userStatus });
      if (loseResponse) throw new Error('provider response lost');
      return { Data: { Uid: options.uid } };
    },
    async modifyUser(options) {
      const user = users.get(options.uid);
      if (!user) return { Data: { Success: false } };
      users.set(user.Uid, { ...user, UserStatus: options.userStatus });
      return { Data: { Success: true } };
    },
  };
  return { provider: new CloudBaseNativeAccountProvider(manager, { digest: value => `sd1_${value}` }),
    creates, users, loseResponse() { loseResponse = true; } };
}
const operationKey = `row_${'c'.repeat(64)}`;
const input = { mobile: '13800000001', displayName: '虚构新学员' };

describe('A-03 manager creates phone identity for P-03 self-service setup', () => {
  it('does not send a password or require a setup/reset challenge capability', async () => {
    const state = fixture();
    const receipt = await state.provider.provision(input, operationKey);
    expect(receipt.platformUid).toMatch(/^imp_[a-f0-9]{40}$/);
    expect(state.creates).toEqual([{ uid: receipt.platformUid, name: receipt.platformUid,
      phone: input.mobile, type: 'externalUser', userStatus: 'ACTIVE' }]);
    expect(state.provider).not.toHaveProperty('requestPasswordReset');
    expect(state.creates[0]).not.toHaveProperty('password');
  });
  it('reconciles a lost manager response without creating a second identity', async () => {
    const state = fixture(); state.loseResponse();
    const first = await state.provider.provision(input, operationKey);
    expect(await state.provider.provision(input, operationKey)).toEqual(first);
    expect(state.creates).toHaveLength(1);
  });
  it('blocks only this operation’s unlinked identity during safe compensation', async () => {
    const state = fixture();
    const receipt = await state.provider.provision(input, operationKey);
    await expect(state.provider.blockUnlinked(receipt, `row_${'d'.repeat(64)}`)).rejects.toThrow('AUTH_ACCOUNT_MISMATCH');
    await state.provider.blockUnlinked(receipt, operationKey);
    expect(state.users.get(receipt.platformUid)?.UserStatus).toBe('BLOCKED');
  });
});
