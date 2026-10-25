import { tcb } from 'tencentcloud-sdk-nodejs-tcb';
import type { CloudBaseManagerUserPort } from '../teacher-students/cloudbase-manager-auth-port';

export interface TcbRuntimeUserCredentials {
  readonly environmentId: string;
  readonly secretId: string;
  readonly secretKey: string;
  readonly sessionToken: string;
}

type TcbClient = InstanceType<typeof tcb.v20180608.Client>;
type TcbClientConfig = ConstructorParameters<typeof tcb.v20180608.Client>[0];
type TcbUserApi = Pick<TcbClient, 'CreateUser' | 'DescribeUserList' | 'ModifyUser'>;
export type TcbUserApiFactory = (config: TcbClientConfig) => TcbUserApi;
type ManagedUser = Awaited<ReturnType<CloudBaseManagerUserPort['describeUserList']>>['Data']['UserList'][number];

/**
 * Adapts the narrow CloudBase user-management actions required by A-03 to the
 * Tencent Cloud TCB API. Credentials are resolved per request from the active
 * Cloud Function role and are never stored on this object.
 */
export class TcbUserManagementPort implements CloudBaseManagerUserPort {
  public constructor(
    private readonly readCredentials: () => TcbRuntimeUserCredentials,
    private readonly createClient: TcbUserApiFactory = config => new tcb.v20180608.Client(config),
  ) {}

  public async describeUserList(options: Readonly<{ uidList?: readonly string[]; phone?: string;
    pageNo?: number; pageSize?: number }>): Promise<Awaited<ReturnType<CloudBaseManagerUserPort['describeUserList']>>> {
    return this.call('describeUserList', async () => {
      const { client, environmentId } = this.client();
      const response = await client.DescribeUserList({ EnvId: environmentId,
        ...(options.uidList === undefined ? {} : { UidList: [...options.uidList] }),
        ...(options.phone === undefined ? {} : { Phone: options.phone }),
        ...(options.pageNo === undefined ? {} : { PageNo: options.pageNo }),
        ...(options.pageSize === undefined ? {} : { PageSize: options.pageSize }) });
      const data = response.Data;
      if (typeof data?.Total !== 'number' || !Number.isSafeInteger(data.Total)
        || !Array.isArray(data.UserList)) throw new Error('TCB_USER_LIST_RESPONSE_INVALID');
      return { Data: { Total: data.Total, UserList: data.UserList.map(mapManagedUser) } };
    });
  }

  public async createUser(options: Readonly<{ uid: string; name: string; phone: string;
    type: 'externalUser'; userStatus: 'ACTIVE' }>): Promise<Readonly<{ Data: Readonly<{ Uid: string }> }>> {
    return this.call('createUser', async () => {
      const { client, environmentId } = this.client();
      const response = await client.CreateUser({ EnvId: environmentId, Uid: options.uid,
        Name: options.name, Phone: options.phone, Type: options.type,
        UserStatus: options.userStatus });
      const uid = response.Data?.Uid;
      if (typeof uid !== 'string' || uid.length === 0) throw new Error('TCB_USER_CREATE_RESPONSE_INVALID');
      return { Data: { Uid: uid } };
    });
  }

  public async modifyUser(options: Readonly<{ uid: string; userStatus: 'BLOCKED' }>):
    Promise<Readonly<{ Data: Readonly<{ Success: boolean }> }>> {
    return this.call('modifyUser', async () => {
      const { client, environmentId } = this.client();
      const response = await client.ModifyUser({ EnvId: environmentId, Uid: options.uid,
        UserStatus: options.userStatus });
      if (typeof response.Data?.Success !== 'boolean') {
        throw new Error('TCB_USER_UPDATE_RESPONSE_INVALID');
      }
      return { Data: { Success: response.Data.Success } };
    });
  }

  private async call<T>(operation: 'describeUserList' | 'createUser' | 'modifyUser',
    action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      console.warn('[native-account] TCB user API unavailable', operation, safeErrorCode(error));
      throw error;
    }
  }

  private client(): Readonly<{ client: TcbUserApi; environmentId: string }> {
    const credentials = this.readCredentials();
    if (!credentials.environmentId.trim() || !credentials.secretId.trim()
      || !credentials.secretKey.trim()) {
      console.warn('[native-account] TCB user API runtime credentials unavailable');
      throw new Error('TCB_USER_RUNTIME_CREDENTIALS_UNAVAILABLE');
    }
    const token = credentials.sessionToken.trim();
    return { environmentId: credentials.environmentId,
      client: this.createClient({ credential: { secretId: credentials.secretId,
        secretKey: credentials.secretKey, ...(token ? { token } : {}) } }) };
  }
}

function safeErrorCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return 'OTHER';
  const code = error.code;
  return /^(?:AuthFailure|FailedOperation|InternalError|InvalidParameterValue|UnauthorizedOperation|RequestLimitExceeded)(?:\.[A-Za-z0-9_-]+)*$/u.test(code)
    ? code : 'OTHER';
}

function mapManagedUser(value: unknown): ManagedUser {
  if (!isRecord(value) || typeof value.Uid !== 'string' || typeof value.Name !== 'string'
    || typeof value.Type !== 'string' || typeof value.Phone !== 'string'
    || value.UserStatus !== 'ACTIVE' && value.UserStatus !== 'BLOCKED') {
    throw new Error('TCB_USER_LIST_ROW_INVALID');
  }
  return { Uid: value.Uid, Name: value.Name, Type: value.Type, Phone: value.Phone,
    UserStatus: value.UserStatus };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
