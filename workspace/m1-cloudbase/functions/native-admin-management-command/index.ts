import { NativeAdminWorkRestoreService } from '../../src/native-admin/work-restore-service';
import { NativeAdminManagementService } from '../../src/native-admin/management-service';
import { NativeAdminAccountService } from '../../src/native-admin/account-service';
import { DocumentNativeAdminGrantRepository } from '../../src/native-admin/document-grant-repository';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createNativeAdminManagementFunction, NATIVE_ADMIN_MANAGEMENT_ACTIONS,
  validateNativeAdminManagementRequest } from './function-entry';

export { createNativeAdminManagementFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('native-admin-management-command',
  NATIVE_ADMIN_MANAGEMENT_ACTIONS, (_action, _payload, request) => {
    const validated = validateNativeAdminManagementRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('native-admin-management-command', unavailable,
  (capabilities, infrastructure) => {
    const grants = new DocumentNativeAdminGrantRepository(infrastructure.documents);
    const management = new NativeAdminManagementService(infrastructure.documents, grants, infrastructure.clock);
    return createNativeAdminManagementFunction({ ...infrastructure,
      management, organizationManagement: management,
      accounts: new NativeAdminAccountService(infrastructure.documents, grants,
        capabilities.subjectDigest, infrastructure.clock, capabilities.nativeAccountProvider),
      workRestore: new NativeAdminWorkRestoreService(infrastructure.documents, grants, infrastructure.clock) });
  });
