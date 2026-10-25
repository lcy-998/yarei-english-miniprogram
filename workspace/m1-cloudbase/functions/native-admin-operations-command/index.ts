import { NativeAdminOperationsService } from '../../src/native-admin/operations-service';
import { DocumentNativeAdminGrantRepository } from '../../src/native-admin/document-grant-repository';
import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { createNativeAdminOperationsFunction, NATIVE_ADMIN_OPERATIONS_ACTIONS,
  validateNativeAdminOperationsRequest } from './function-entry';

export { createNativeAdminOperationsFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('native-admin-operations-command',
  NATIVE_ADMIN_OPERATIONS_ACTIONS, (_action, _payload, request) => {
    const validated = validateNativeAdminOperationsRequest(request);
    return validated.ok ? null : validated.fieldErrors;
  });
export const main = createDefaultCloudBaseFunction('native-admin-operations-command', unavailable,
  (_capabilities, infrastructure) => {
    const grants = new DocumentNativeAdminGrantRepository(infrastructure.documents);
    return createNativeAdminOperationsFunction({ ...infrastructure,
      operations: new NativeAdminOperationsService(infrastructure.documents, grants, infrastructure.clock) });
  });
