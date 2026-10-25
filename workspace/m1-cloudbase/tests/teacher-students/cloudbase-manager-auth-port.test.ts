import { describe, expect, it } from 'vitest';
import { cloudbaseUsernameSubject } from '../../src/auth/trusted-actor';
import type { SubjectDigestPort } from '../../src/runtime/ports';
import { CloudBaseManagerStudentAuthPort, type CloudBaseManagerUserPort,
} from '../../src/teacher-students/cloudbase-manager-auth-port';
import type { TeacherStudentImportCommandPlanRow } from '../../src/teacher-students/bulk-csv';

const row: TeacherStudentImportCommandPlanRow = { sourceLineNumber: 2,
  studentNumber: 'DEMO100', displayName: '测试学员甲', mobile: '13900000100', classId: 'class_demo' };
const rowKey = `row_${'a'.repeat(64)}`;
const otherRowKey = `row_${'b'.repeat(64)}`;
const digest: SubjectDigestPort = { digest(subject) { return `sd1_${subject}`; } };

function fixture() {
  type User = { Uid: string; Name: string; Type: string; Phone: string;
    UserStatus: 'ACTIVE' | 'BLOCKED' };
  const users = new Map<string, User>();
  let createCalls = 0;
  let loseCreateResponse = false;
  const manager: CloudBaseManagerUserPort = {
    async describeUserList(options) {
      const found = [...users.values()].filter(user => options.uidList?.includes(user.Uid)
        || options.phone === user.Phone);
      return { Data: { Total: found.length, UserList: found } };
    },
    async createUser(options) {
      createCalls += 1;
      if ([...users.values()].some(user => user.Phone === options.phone)) throw new Error('duplicate phone');
      users.set(options.uid, { Uid: options.uid, Name: options.name, Type: options.type,
        Phone: options.phone, UserStatus: options.userStatus });
      if (loseCreateResponse) throw new Error('response lost');
      return { Data: { Uid: options.uid } };
    },
    async modifyUser(options) {
      const user = users.get(options.uid);
      if (!user) return { Data: { Success: false } };
      users.set(options.uid, { ...user, UserStatus: options.userStatus });
      return { Data: { Success: true } };
    },
  };
  return { adapter: new CloudBaseManagerStudentAuthPort(manager, digest), users,
    get createCalls() { return createCalls; }, loseNextResponse() { loseCreateResponse = true; } };
}

describe('T-02 CloudBase manager Auth adapter candidate', () => {
  it('reconciles a lost creation response by deterministic UID without a duplicate account', async () => {
    const state = fixture(); state.loseNextResponse();
    const receipt = await state.adapter.createExternalStudent(row, rowKey);
    expect(receipt.platformUid).toMatch(/^imp_[a-f0-9]{40}$/);
    expect(receipt.subjectDigest).toBe(`sd1_${cloudbaseUsernameSubject(receipt.platformUid)}`);
    expect(state.createCalls).toBe(1);
    expect(state.users.size).toBe(1);
    expect(await state.adapter.mobileExists(row.mobile, rowKey)).toBe(false);
    expect(await state.adapter.mobileExists(row.mobile, otherRowKey)).toBe(true);
    expect(await state.adapter.createExternalStudent(row, rowKey)).toEqual(receipt);
    expect(state.createCalls).toBe(1);
    expect(state.users.size).toBe(1);
  });

  it('blocks only its own unlinked account and refuses to revive it on retry', async () => {
    const state = fixture();
    const receipt = await state.adapter.createExternalStudent(row, rowKey);
    await expect(state.adapter.blockUnlinkedAccount(receipt, otherRowKey))
      .rejects.toThrow('AUTH_ACCOUNT_MISMATCH');
    await state.adapter.blockUnlinkedAccount(receipt, rowKey);
    expect(state.users.get(receipt.platformUid)?.UserStatus).toBe('BLOCKED');
    await expect(state.adapter.createExternalStudent(row, rowKey)).rejects.toThrow('AUTH_ACCOUNT_CONFLICT');
  });
});
