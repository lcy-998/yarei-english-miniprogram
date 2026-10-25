import { CloudBaseNativeAccountProvider } from '../../src/native-admin/cloudbase-account-provider';
import { TcbUserManagementPort } from '../../src/native-admin/tcb-user-management-port';
import type { NativeAccountProviderFactory } from '../shared/default-cloudbase-function';

export const createTcbNativeAccountProviderFactory: NativeAccountProviderFactory = context =>
  new CloudBaseNativeAccountProvider(new TcbUserManagementPort(() => {
    const runtime = context.getRuntimeContext();
    return { environmentId: context.environmentId,
      secretId: requiredRuntimeCredential(runtime, 'TENCENTCLOUD_SECRETID'),
      secretKey: requiredRuntimeCredential(runtime, 'TENCENTCLOUD_SECRETKEY'),
      sessionToken: requiredRuntimeCredential(runtime, 'TENCENTCLOUD_SESSIONTOKEN') };
  }), context.subjectDigest);

function requiredRuntimeCredential(runtime: Readonly<Record<string, unknown>>, key: string): string {
  const value = runtime[key];
  return typeof value === 'string' ? value : '';
}
