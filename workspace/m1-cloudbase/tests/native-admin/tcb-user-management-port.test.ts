import { describe, expect, it, vi } from 'vitest';
import { TcbUserManagementPort, type TcbUserApiFactory } from '../../src/native-admin/tcb-user-management-port';

describe('CloudBase TCB user-management port', () => {
  it('uses only the current function-role credentials and performs passwordless external-user operations', async () => {
    let listRequest: Record<string, unknown> | null = null;
    let createRequest: Record<string, unknown> | null = null;
    let modifyRequest: Record<string, unknown> | null = null;
    let config: Parameters<TcbUserApiFactory>[0] | null = null;
    const client = {
      async DescribeUserList(request: Record<string, unknown>) {
        listRequest = request;
        return { Data: { Total: 1, UserList: [{ Uid: 'uid_demo_teacher', Name: 'uid_demo_teacher',
          Type: 'externalUser', Phone: '13800000009', UserStatus: 'ACTIVE' }] } };
      },
      async CreateUser(request: Record<string, unknown>) {
        createRequest = request;
        return { Data: { Uid: 'uid_demo_teacher' } };
      },
      async ModifyUser(request: Record<string, unknown>) {
        modifyRequest = request;
        return { Data: { Success: true } };
      },
    };
    const factory = vi.fn<TcbUserApiFactory>((value) => {
      config = value;
      return client as unknown as ReturnType<TcbUserApiFactory>;
    });
    const port = new TcbUserManagementPort(() => ({ environmentId: 'env_nonproduction',
      secretId: 'temporary_id', secretKey: 'temporary_key', sessionToken: 'temporary_token' }), factory);

    await expect(port.describeUserList({ phone: '13800000009', pageNo: 1, pageSize: 100 }))
      .resolves.toMatchObject({ Data: { Total: 1,
        UserList: [{ Uid: 'uid_demo_teacher', Phone: '13800000009', UserStatus: 'ACTIVE' }] } });
    await expect(port.createUser({ uid: 'uid_demo_teacher', name: 'uid_demo_teacher',
      phone: '13800000009', type: 'externalUser', userStatus: 'ACTIVE' }))
      .resolves.toEqual({ Data: { Uid: 'uid_demo_teacher' } });
    await expect(port.modifyUser({ uid: 'uid_demo_teacher', userStatus: 'BLOCKED' }))
      .resolves.toEqual({ Data: { Success: true } });

    expect(listRequest).toMatchObject({ EnvId: 'env_nonproduction', Phone: '13800000009',
      PageNo: 1, PageSize: 100 });
    expect(createRequest).toMatchObject({ EnvId: 'env_nonproduction', Type: 'externalUser',
      UserStatus: 'ACTIVE', Phone: '13800000009' });
    expect(createRequest).not.toHaveProperty('Password');
    expect(modifyRequest).toEqual({ EnvId: 'env_nonproduction', Uid: 'uid_demo_teacher',
      UserStatus: 'BLOCKED' });
    expect(config).toEqual({ credential: { secretId: 'temporary_id',
      secretKey: 'temporary_key', token: 'temporary_token' } });
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('rejects missing temporary runtime credentials before making an API request', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = vi.fn<TcbUserApiFactory>(() => {
      throw new Error('MANAGER_API_MUST_NOT_BE_CALLED');
    });
    const port = new TcbUserManagementPort(() => ({ environmentId: 'env_nonproduction',
      secretId: '', secretKey: '', sessionToken: '' }), factory);

    await expect(port.describeUserList({ phone: '13800000009', pageNo: 1, pageSize: 100 }))
      .rejects.toThrow('TCB_USER_RUNTIME_CREDENTIALS_UNAVAILABLE');
    expect(factory).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('[native-account] TCB user API runtime credentials unavailable');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('13800000009');
    warning.mockRestore();
  });

  it('accepts function credentials without a session token when the role supplies a key pair', async () => {
    let config: Parameters<TcbUserApiFactory>[0] | null = null;
    const client = {
      async DescribeUserList() { return { Data: { Total: 0, UserList: [] } }; },
      async CreateUser() { return { Data: { Uid: 'uid_demo_teacher' } }; },
      async ModifyUser() { return { Data: { Success: true } }; },
    };
    const factory = vi.fn<TcbUserApiFactory>((value) => {
      config = value;
      return client as unknown as ReturnType<TcbUserApiFactory>;
    });
    const port = new TcbUserManagementPort(() => ({ environmentId: 'env_nonproduction',
      secretId: 'temporary_id', secretKey: 'temporary_key', sessionToken: '' }), factory);

    await expect(port.describeUserList({ phone: '13800000009' }))
      .resolves.toMatchObject({ Data: { Total: 0, UserList: [] } });
    expect(config).toEqual({ credential: { secretId: 'temporary_id', secretKey: 'temporary_key' } });
  });

  it('logs only a safe API error code and never the request data', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      async DescribeUserList() {
        const error = new Error('phone 13800000009');
        Object.assign(error, { code: 'AuthFailure.AccessDenied' });
        throw error;
      },
      async CreateUser() { return { Data: { Uid: 'uid_demo_teacher' } }; },
      async ModifyUser() { return { Data: { Success: true } }; },
    };
    const factory: TcbUserApiFactory = () => client as unknown as ReturnType<TcbUserApiFactory>;
    const port = new TcbUserManagementPort(() => ({ environmentId: 'env_nonproduction',
      secretId: 'temporary_id', secretKey: 'temporary_key', sessionToken: 'temporary_token' }), factory);

    await expect(port.describeUserList({ phone: '13800000009', pageNo: 1, pageSize: 100 }))
      .rejects.toThrow('phone 13800000009');
    expect(warning).toHaveBeenCalledWith('[native-account] TCB user API unavailable',
      'describeUserList', 'AuthFailure.AccessDenied');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('13800000009');
    warning.mockRestore();
  });
});
