import { createDefaultCloudBaseFunction } from '../shared/default-cloudbase-function';
import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { DocumentNativeAdminGrantRepository } from '../../src/native-admin/document-grant-repository';
import { NativeAdminQueryService } from '../../src/native-admin/query-service';
import { NativeAdminDataService } from '../../src/native-admin/data-service';
import { NativeAdminWorkRestoreService } from '../../src/native-admin/work-restore-service';
import { NativeAdminGrantCandidateService } from '../../src/native-admin/grant-candidate-service';
import { createNativeAdminQueryFunction, NATIVE_ADMIN_QUERY_ACTIONS,
  validateNativeAdminQueryRequest } from './function-entry';

export { createNativeAdminQueryFunction } from './function-entry';

const unavailable = createUnconfiguredFunction('native-admin-query', NATIVE_ADMIN_QUERY_ACTIONS,
  (_action, _payload, request) => {
    const result = validateNativeAdminQueryRequest(request);
    return result.ok ? null : result.fieldErrors;
  });

export const main = createDefaultCloudBaseFunction('native-admin-query', unavailable,
  (capabilities, infrastructure) => {
    const grants = new DocumentNativeAdminGrantRepository(infrastructure.documents);
    return createNativeAdminQueryFunction({ ...infrastructure,
      service: new NativeAdminQueryService(grants),
      dataService: new NativeAdminDataService(grants, infrastructure.documents,
        capabilities.playbackStorage),
      workRestore: new NativeAdminWorkRestoreService(infrastructure.documents, grants,
        infrastructure.clock),
      grantCandidates: new NativeAdminGrantCandidateService(grants, infrastructure.documents) });
  });
