import { NativeAdminGrantService } from '../../src/native-admin/grant-service';
import { DocumentNativeAdminGrantRepository } from '../../src/native-admin/document-grant-repository';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createNativeAdminCommandFunction, NATIVE_ADMIN_COMMAND_ACTIONS,
  validateNativeAdminCommandRequest } from './function-entry';

export { createNativeAdminCommandFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('native-admin-command', NATIVE_ADMIN_COMMAND_ACTIONS,
  (_action, _payload, request) => {
    const validated = validateNativeAdminCommandRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('native-admin-command', unavailable,
  (capabilities, infrastructure) => {
    const grants = new DocumentNativeAdminGrantRepository(infrastructure.documents);
    return createNativeAdminCommandFunction({ ...infrastructure,
      grants: new NativeAdminGrantService(grants, infrastructure.clock,
        capabilities.identifiers, grants) });
  });
